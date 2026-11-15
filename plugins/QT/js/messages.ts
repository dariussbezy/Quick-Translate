import { Dispatcher } from '@valenced/discord/common/flux'
import { channelOf, currentUserId, getChannel, getMessage, toast } from './env'
import { languageName } from './shared'
import { getSettings, updateSettings } from './store'
import { clearCaches, notifyTranslated, translate } from './translate'
import type { Message, MessageNode } from './env'
import type { HistoryEntry, Provider, SavedTranslation } from './shared'

const MAX_TRANSLATIONS = 300

/** Translations of messages, by message id, oldest first. */
const translations = new Map<string, SavedTranslation>()
/** Rows whose translation changed; the render patch must rebind them. */
const staleRows = new Set<string>()
const autoSeen = new Set<string>()

const trim = <V>(map: Map<string, V> | Set<string>, max: number) => {
	while (map.size > max) map.delete(map.keys().next().value as string)
}

export const getTranslation = (id: string) => translations.get(id)
export const hasTranslation = (id: string) => translations.has(id)

/** True once for a row that changed, so Discord is told to render it again. */
export const consumeStale = (id: string) => staleRows.delete(id)

/** Plain text of a message that Discord already parsed into nodes. */
export function messageText(value: string | MessageNode[] | undefined) {
	if (typeof value === 'string') return value
	const parts: string[] = []
	const visit = (node: unknown) => {
		if (typeof node === 'string') return void parts.push(node)
		if (!node || typeof node !== 'object') return
		const { type, content, name } = node as MessageNode
		if (typeof content === 'string') parts.push(content)
		else if (Array.isArray(content)) content.forEach(visit)
		if (type === 'customEmoji' && name) parts.push(`:${name}:`)
	}
	if (Array.isArray(value)) value.forEach(visit)
	return parts.join('')
}

function refreshRow(channelId: string, id: string) {
	if (!getMessage(channelId, id)) return
	const guildId = getChannel(channelId)?.guild_id
	staleRows.add(id)
	trim(staleRows, MAX_TRANSLATIONS)
	void Dispatcher.dispatch({
		type: 'MESSAGE_UPDATE',
		guildId,
		message: { id, channel_id: channelId, guild_id: guildId },
	})
}

export function refreshAll() {
	for (const { channelId, messageId } of translations.values())
		refreshRow(channelId, messageId)
}

function persist() {
	const { keepMessageTranslations, messageTranslations } = getSettings()
	if (!keepMessageTranslations && !messageTranslations.length) return
	updateSettings({
		messageTranslations: keepMessageTranslations
			? [...translations.values()].reverse()
			: [],
	})
}

/** Restores the translations saved before the last restart. */
export function loadTranslations() {
	translations.clear()
	const { keepMessageTranslations, messageTranslations } = getSettings()
	if (keepMessageTranslations)
		for (const entry of messageTranslations
			.slice(0, MAX_TRANSLATIONS)
			.reverse()) {
			if (
				typeof entry?.messageId !== 'string' ||
				typeof entry.channelId !== 'string' ||
				typeof entry.translated !== 'string'
			)
				continue
			translations.set(entry.messageId, {
				...entry,
				source: entry.source || 'auto',
				target: entry.target || 'en',
				provider: entry.provider || 'google',
				at: Number(entry.at) || Date.now(),
				autoIncoming: !!entry.autoIncoming,
			})
		}
	refreshAll()
}

export function unloadTranslations() {
	const rows = [...translations.values()]
	translations.clear()
	autoSeen.clear()
	for (const { channelId, messageId } of rows) refreshRow(channelId, messageId)
}

export function setKeepTranslations(keep: boolean) {
	updateSettings({ keepMessageTranslations: keep })
	persist()
}

interface TranslateMessageOptions {
	silent?: boolean
	source?: string
	autoIncoming?: boolean
}

export async function translateMessage(
	message: Message,
	target: string,
	{
		silent = false,
		source = 'auto',
		autoIncoming = false,
	}: TranslateMessageOptions = {},
) {
	const text = message.content
	if (typeof text !== 'string' || !text.trim()) {
		if (!silent) toast('This message has no text')
		return false
	}
	const channelId = channelOf(message)
	const messageId = String(message.id)
	try {
		const result = await translate(text, target, source, {
			pretty: true,
			channelId,
			messageId,
			automatic: autoIncoming,
		})
		if (result.same) {
			if (!silent) toast(`Already in ${languageName(target)}`)
			return true
		}
		translations.delete(messageId)
		translations.set(messageId, {
			id: `${channelId}|${messageId}`,
			messageId,
			channelId,
			original: text,
			translated: result.text,
			source: result.src || 'auto',
			target,
			at: Date.now(),
			provider: result.provider ?? getSettings().provider,
			autoIncoming,
		})
		trim(translations, MAX_TRANSLATIONS)
		persist()
		setTimeout(() => refreshRow(channelId, messageId), silent ? 220 : 0)
		if (!silent) notifyTranslated(result)
		return true
	} catch (error) {
		if (!silent)
			toast(`Translation failed: ${(error as Error)?.message ?? error}`)
		return false
	}
}

/** Translates messages one after another; resolves to whether the sheet can close. */
export async function translateMessages(
	messages: Message[],
	target: string,
	source: string,
) {
	if (messages.length === 1) {
		const [message] = messages
		const id = String(message.id)
		const before = translations.get(id)?.at
		const ok = await translateMessage(message, target, { source })
		const now = translations.get(id)
		return (
			ok &&
			!!now &&
			now.at !== before &&
			now.translated.trim() !== String(message.content).trim()
		)
	}
	let translated = 0
	let already = 0
	let failed = 0
	const services: Record<Provider, number> = {
		deepl: 0,
		google: 0,
		microsoft: 0,
	}
	for (const message of messages) {
		const id = String(message.id)
		const previous = translations.get(id)
		const ok = await translateMessage(message, target, { silent: true, source })
		const current = translations.get(id)
		if (!ok) failed++
		else if (current && current !== previous) {
			translated++
			services[current.provider]++
		} else already++
	}
	const named = getSettings().provider !== 'google'
	const used = [
		named && services.google && `${services.google} Google Translate`,
		named && services.microsoft && `${services.microsoft} Microsoft`,
		named && services.deepl && `${services.deepl} DeepL`,
	].filter(Boolean)
	toast(
		`${translated} translated${used.length ? ` · ${used.join(' · ')}` : ''} · ${already} already in ${languageName(target)} · ${failed} failed`,
	)
	return true
}

export function showOriginal(message: Message) {
	const id = String(message.id)
	translations.delete(id)
	persist()
	refreshRow(channelOf(message), id)
}

export function deleteHistoryEntry(entry: HistoryEntry) {
	updateSettings({
		historyEntries: getSettings().historyEntries.filter(
			item => item.id !== entry.id,
		),
	})
	if (!entry.messageId) return
	translations.delete(entry.messageId)
	persist()
	if (entry.channelId) refreshRow(entry.channelId, entry.messageId)
}

export function clearTranslationData() {
	const rows = [...translations.values()]
	clearCaches()
	translations.clear()
	updateSettings({ historyEntries: [], messageTranslations: [] })
	for (const { channelId, messageId } of rows) refreshRow(channelId, messageId)
	toast('Translation history, saved message translations and cache cleared')
}

/** Translates new messages in the selected channels and links sent drafts to their history entries. */
export function onIncomingMessage(event: {
	message?: Message
	channelId?: string
}) {
	const settings = getSettings()
	const message = event.message
	const channelId = String(event.channelId ?? message?.channel_id ?? '')
	if (
		!message?.id ||
		!channelId ||
		typeof message.content !== 'string' ||
		!message.content.trim()
	)
		return
	if (message.type != null && message.type !== 0) return
	const id = String(message.id)

	const me = currentUserId()
	if (me && message.author?.id === me) {
		const entry = settings.historyEntries.find(
			item =>
				!item.messageId &&
				item.channelId === channelId &&
				item.translated === message.content &&
				Date.now() - item.at < 10 * 60 * 1000,
		)
		if (entry)
			updateSettings({
				historyEntries: settings.historyEntries.map(item =>
					item === entry ? { ...item, messageId: id } : item,
				),
			})
		return
	}
	if (!settings.autoChannelIds.includes(channelId) || autoSeen.has(id)) return
	autoSeen.add(id)
	trim(autoSeen, 500)
	void translateMessage(message, settings.targetIn, {
		silent: true,
		autoIncoming: true,
	})
}
