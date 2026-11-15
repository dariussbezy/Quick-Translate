import { channelLabel, getChannel, getUser, toast, userName } from './env'
import {
	assertCurrent,
	cancelAll,
	currentGeneration,
	enqueue,
	fetchWithTimeout,
} from './runtime'
import {
	isLanguage,
	languageName,
	normalizeLanguage,
	ProviderLabels,
} from './shared'
import { getSettings, updateSettings } from './store'
import { findWord, prepareWordRules } from './word-rules'
import type { Provider } from './shared'

const MAX_HISTORY = 100
const DEFAULT_COOLDOWN = 60000
// The "gtx" endpoint is throttled by Google almost immediately; this one is the Chrome extension endpoint.
const GOOGLE_ENDPOINT =
	'https://clients5.google.com/translate_a/t?client=dict-chrome-ex'

/** Code blocks, inline code, emoji, mentions, timestamps and links are never translated. */
const PROTECTED =
	/```[\s\S]*?```|`[^`\n]+`|<a?:\w+:\d+>|<[@#][!&]?\d+>|<t:-?\d+(?::[A-Za-z])?>|https?:\/\/[^\s<>]+/g
const PLACEHOLDER = /§\s*\d+\s*§/g

export interface TranslateResult {
	text: string
	src: string
	same?: boolean
	provider?: Provider
}

interface TranslateOptions {
	/** Render mentions and channels by name (for display) instead of keeping them verbatim. */
	pretty?: boolean
	channelId?: string | null
	messageId?: string | null
	automatic?: boolean
}

interface ProviderResult {
	text: string
	src: string
}

class HttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly retryAfterMs = DEFAULT_COOLDOWN,
	) {
		super(message)
	}
}

const inFlight = new Map<string, Promise<TranslateResult>>()
const cooldowns = new Map<Provider, number>()

export function clearCaches() {
	cancelAll()
	inFlight.clear()
}

/* -------------------------------- providers -------------------------------- */

function httpError(
	label: string,
	response: Response,
	json?: { message?: string } | null,
) {
	const header = response.headers?.get('Retry-After')
	const seconds = Number(header)
	const dateMs =
		header && !Number.isFinite(seconds) ? Date.parse(header) - Date.now() : 0
	const retryAfterMs =
		seconds > 0 ? seconds * 1000 : dateMs > 0 ? dateMs : DEFAULT_COOLDOWN
	return new HttpError(
		`${json?.message || label} (HTTP ${response.status})`,
		response.status,
		retryAfterMs,
	)
}

async function google(
	text: string,
	tl: string,
	sl: string,
): Promise<ProviderResult> {
	const response =
		text.length < 1200
			? await fetchWithTimeout(
					`${GOOGLE_ENDPOINT}&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(text)}`,
				)
			: await fetchWithTimeout(
					`${GOOGLE_ENDPOINT}&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
						},
						body: `q=${encodeURIComponent(text)}`,
					},
				)
	if (!response.ok) throw httpError('Google Translate request failed', response)
	const json = await response.json()
	const first: unknown = Array.isArray(json) ? json[0] : null
	const out =
		Array.isArray(first) && typeof first[0] === 'string' ? first[0] : ''
	if (!out && text.trim()) throw new Error('Empty response')
	const src =
		Array.isArray(first) && typeof first[1] === 'string' ? first[1] : sl
	return { text: out, src }
}

// The keyless endpoint Microsoft Edge uses for its built-in page translator.
const MICROSOFT_ENDPOINT = 'https://edge.microsoft.com/translate/translatetext'
const MICROSOFT_CODES: Record<string, string> = {
	'zh-CN': 'zh-Hans',
	'zh-TW': 'zh-Hant',
	no: 'nb',
	iw: 'he',
	jw: 'jv',
	tl: 'fil',
}
const microsoftCode = (code: string) => MICROSOFT_CODES[code] ?? code

async function microsoft(
	text: string,
	tl: string,
	sl: string,
): Promise<ProviderResult> {
	const url = `${MICROSOFT_ENDPOINT}?to=${encodeURIComponent(microsoftCode(tl))}${
		sl !== 'auto' ? `&from=${encodeURIComponent(microsoftCode(sl))}` : ''
	}`
	const response = await fetchWithTimeout(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify([text]),
	})
	const json = await response.json().catch(() => null)
	if (!response.ok)
		throw httpError(
			'Microsoft Translator request failed',
			response,
			json?.error,
		)
	const first = Array.isArray(json) ? json[0] : null
	const out = first?.translations?.[0]?.text
	if (typeof out !== 'string' || (!out && text.trim()))
		throw new Error('Empty response')
	return {
		text: out,
		src: String(first?.detectedLanguage?.language || sl),
	}
}

const DEEPL_SOURCE: Record<string, string> = {
	'zh-CN': 'ZH',
	'zh-TW': 'ZH',
	no: 'NB',
}
const DEEPL_TARGET: Record<string, string> = {
	en: 'EN-US',
	pt: 'PT-BR',
	'zh-CN': 'ZH-HANS',
	'zh-TW': 'ZH-HANT',
	no: 'NB',
}
const deeplCode = (code: string) => DEEPL_SOURCE[code] ?? code.toUpperCase()

async function deepl(
	text: string,
	tl: string,
	sl: string,
): Promise<ProviderResult> {
	const key = getSettings().deeplApiKey.trim()
	if (!key)
		throw new Error('Add your DeepL API key in Quick Translate settings')
	const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com'
	const source = sl !== 'auto' ? deeplCode(sl) : undefined
	const response = await fetchWithTimeout(`https://${host}/v2/translate`, {
		method: 'POST',
		headers: {
			Authorization: `DeepL-Auth-Key ${key}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			text: [text],
			target_lang: DEEPL_TARGET[tl] ?? deeplCode(tl),
			...(source && { source_lang: source }),
		}),
	})
	const json = await response.json().catch(() => null)
	if (!response.ok) throw httpError('DeepL request failed', response, json)
	const first = json?.translations?.[0]
	if (!first?.text)
		throw new Error(json?.message || 'DeepL returned an empty translation')
	return {
		text: String(first.text),
		src: String(
			first.detected_source_language || source || 'auto',
		).toLowerCase(),
	}
}

const providers: Record<Provider, typeof google> = { google, microsoft, deepl }

const providerName = (provider: Provider) =>
	provider === 'google'
		? 'Google Translate'
		: provider === 'microsoft'
			? 'Microsoft Translator'
			: ProviderLabels[provider]

/** One queued provider request; a provider that answered HTTP 429 is paused for a while. */
async function callProvider(
	provider: Provider,
	text: string,
	tl: string,
	sl: string,
	automatic = false,
) {
	const checkCooldown = () => {
		const until = cooldowns.get(provider) ?? 0
		if (until > Date.now())
			throw new HttpError(
				`${provider} is paused after HTTP 429; retry in ${Math.ceil((until - Date.now()) / 1000)}s`,
				429,
			)
	}
	checkCooldown()
	return enqueue(async () => {
		checkCooldown()
		try {
			return await providers[provider](text, tl, sl)
		} catch (error) {
			if (error instanceof HttpError && error.status === 429)
				cooldowns.set(
					provider,
					Date.now() + Math.max(DEFAULT_COOLDOWN, error.retryAfterMs),
				)
			throw error
		}
	}, automatic)
}

/** Asks Google for the language of a text only; used by Voice Messages To Text. */
export function detectLanguage(
	text: string,
	signal?: AbortSignal,
	automatic = false,
) {
	const paused = () => {
		if ((cooldowns.get('google') ?? 0) > Date.now())
			throw new HttpError('Google Translate is paused after HTTP 429', 429)
	}
	paused()
	return enqueue(async () => {
		paused()
		const response = await fetchWithTimeout(
			`${GOOGLE_ENDPOINT}&sl=auto&tl=en&q=${encodeURIComponent(text)}`,
			{ signal },
		)
		if (response.status === 429) {
			const error = httpError('Google Translate', response)
			cooldowns.set(
				'google',
				Date.now() + Math.max(DEFAULT_COOLDOWN, error.retryAfterMs),
			)
			throw error
		}
		if (!response.ok) return null
		const first: unknown = (await response.json())?.[0]
		const code = Array.isArray(first) ? first[1] : null
		return typeof code === 'string' && code !== 'auto' ? code : null
	}, automatic)
}

/** Translates an arbitrary text with one provider, bypassing cache, rules and fallback. */
export async function translateWith(
	provider: Provider,
	text: string,
	tl: string,
	sl: string,
) {
	const { out, tokens } = protect(text)
	const result = await enqueue(() => providers[provider](out, tl, sl))
	return restore(result.text, tokens, false)
}

/* ------------------------- protecting words and links ------------------------ */

function protect(text: string) {
	const tokens: string[] = []
	const hold = (match: string) => `§${tokens.push(match) - 1}§`
	// Text that already looks like one of our placeholders is kept verbatim.
	let out = text.replace(PLACEHOLDER, hold).replace(PROTECTED, hold)
	for (const raw of getSettings().protectedWords) {
		const word = raw.trim()
		if (!word) continue
		const found = findWord(out, word)
		for (const { start, end, text: match } of found.reverse())
			out = out.slice(0, start) + hold(match) + out.slice(end)
	}
	return { out, tokens }
}

function prettyToken(token: string) {
	if (/^<a?:[\w~]+:\d+>$/.test(token)) return token
	let match = /^<@!?(\d+)>$/.exec(token)
	if (match) return `@${userName(getUser(match[1]))}`
	match = /^<#(\d+)>$/.exec(token)
	if (match) return `#${getChannel(match[1])?.name ?? 'channel'}`
	if (/^<@&\d+>$/.test(token)) return '@role'
	if (token.startsWith('<t:')) return ''
	return token
}

export function restore(text: string, tokens: string[], pretty: boolean) {
	const used = new Set<number>()
	let out = text.replace(/§\s*(\d+)\s*§/g, (match, index) => {
		const token = tokens[Number(index)]
		if (token === undefined) return match
		used.add(Number(index))
		return pretty ? prettyToken(token) : token
	})
	// A provider that dropped a placeholder must not lose the protected text.
	if (!pretty) {
		const missing = tokens.filter((_, index) => !used.has(index))
		if (missing.length) out += ` ${missing.join(' ')}`
	}
	return out
}

/* --------------------------------- pipeline ---------------------------------- */

function addHistory(
	original: string,
	result: TranslateResult,
	target: string,
	channelId: string | null,
	messageId: string | null,
) {
	const settings = getSettings()
	if (!settings.saveHistory || !result.text || result.same) return
	const provider = result.provider ?? settings.provider
	const source = result.src || 'auto'
	const id = [
		channelId || 'draft',
		messageId || '',
		provider,
		source,
		target,
		original,
	].join('|')
	updateSettings({
		historyEntries: [
			{
				id,
				original,
				translated: result.text,
				source,
				target,
				provider,
				at: Date.now(),
				channelId,
				channelName: channelLabel(channelId),
				messageId,
			},
			...settings.historyEntries.filter(entry => entry.id !== id),
		].slice(0, MAX_HISTORY),
	})
}

export function translate(
	text: string,
	tl: string,
	sl = 'auto',
	{
		pretty = false,
		channelId = null,
		messageId = null,
		automatic = false,
	}: TranslateOptions = {},
) {
	const settings = getSettings()
	const rules =
		sl === 'auto'
			? settings.wordLanguageRules
					.filter(rule => rule.word.trim() && isLanguage(rule.language))
					.slice(0, 100)
			: []
	const key = JSON.stringify([
		settings.provider,
		pretty,
		sl,
		tl,
		settings.protectedWords
			.map(word => word.toLowerCase().trim())
			.filter(Boolean)
			.sort()
			.join(','),
		rules.map(rule => [rule.word, rule.language]),
		text,
	])
	const since = currentGeneration()
	const record = (result: TranslateResult) => {
		if (since === currentGeneration())
			addHistory(text, result, tl, channelId, messageId)
		return result
	}
	const running = inFlight.get(key)
	if (running) return running.then(record)

	const { out, tokens } = protect(text)
	if (!out.replace(/§\d+§/g, '').trim())
		return Promise.resolve<TranslateResult>({ same: true, text, src: sl })

	const run = async (provider: Provider) => {
		const part = (fragment: string, source: string) =>
			callProvider(provider, fragment, tl, source, automatic)
		const prepared = await prepareWordRules(
			out,
			tokens,
			rules,
			tl,
			async (word, language) => {
				const result = await part(word, language)
				assertCurrent(since)
				return result.text
			},
		)
		const result = prepared.out.replace(PLACEHOLDER, '').trim()
			? await part(prepared.out, sl)
			: { text: prepared.out, src: prepared.source || sl }
		for (
			let index = tokens.length;
			prepared.applied && index < prepared.tokens.length;
			index++
		) {
			const marker = new RegExp(`§\\s*${index}\\s*§`, 'g')
			if ((result.text.match(marker) ?? []).length !== 1)
				throw new Error('Translation provider changed a word-rule marker')
		}
		return {
			...result,
			provider,
			tokens: prepared.tokens,
			ruleApplied: prepared.applied,
		}
	}

	const attempt =
		settings.provider !== 'google'
			? run(settings.provider).catch(firstError => {
					if (
						since !== currentGeneration() ||
						(firstError as HttpError).status === 429
					)
						throw firstError
					return run('google').catch(googleError => {
						throw new Error(
							`${ProviderLabels[settings.provider]} and Google failed: ${googleError?.message || firstError?.message || 'request failed'}`,
						)
					})
				})
			: run('google')

	const request = attempt.then((res): TranslateResult => {
		assertCurrent(since)
		const detected = res.src.toLowerCase().split('-')[0]
		const translated = restore(res.text, res.tokens, pretty)
		const same =
			sl === 'auto' &&
			((!res.ruleApplied &&
				(!detected ||
					detected === 'auto' ||
					detected === tl.toLowerCase().split('-')[0])) ||
				translated === text)
		const result = {
			same,
			text: same ? text : translated,
			src: res.src,
			provider: res.provider,
		}
		return result
	})
	inFlight.set(key, request)
	const forget = () => {
		if (inFlight.get(key) === request) inFlight.delete(key)
	}
	request.then(forget, forget)
	return request.then(record)
}

/** Toast shown once a translation finished; names the service when a DeepL key is set. */
export function notifyTranslated(result: TranslateResult) {
	const settings = getSettings()
	const named = settings.provider !== 'google'
	const fallback =
		settings.provider !== 'google' && result.provider === 'google'
	let label = named
		? `Translated with ${providerName(result.provider ?? 'google')}${fallback ? ` (${ProviderLabels[settings.provider]} fallback)` : ''}`
		: 'Translated'
	if (!settings.showSourceLanguage) {
		const code = normalizeLanguage(result.src)
		if (isLanguage(code))
			label += `${named ? ' · from' : ' from'} ${languageName(code)}`
	}
	toast(label)
}
