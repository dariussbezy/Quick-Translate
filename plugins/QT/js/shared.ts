import { Tokens } from '@valenced/discord/common/tokens'
import type { WordRule } from './word-rules'

export type Provider = 'google' | 'microsoft' | 'deepl'

export const ProviderLabels: Record<Provider, string> = {
	google: 'Google',
	microsoft: 'Microsoft',
	deepl: 'DeepL',
}
export type Anchor = 'actions' | 'send'

export interface ChatLanguages {
	sourceOut: string
	targetOut: string
}

export interface HistoryEntry {
	id: string
	original: string
	translated: string
	source: string
	target: string
	provider: Provider
	at: number
	channelId: string | null
	channelName: string
	messageId: string | null
	alternativeTranslated?: string
	alternativeProvider?: Provider
}

export interface SavedTranslation {
	id: string
	messageId: string
	channelId: string
	original: string
	translated: string
	source: string
	target: string
	at: number
	provider: Provider
	autoIncoming: boolean
}

export interface Settings {
	provider: Provider
	deeplApiKey: string
	targetOut: string
	sourceOut: string
	targetIn: string
	favLangs: string[]
	rememberLanguagesPerChat: boolean
	chatLanguages: Record<string, ChatLanguages>
	showButton: boolean
	draftBeforeSend: boolean
	highlightDraftButton: boolean
	keepArmed: boolean
	hideGiftButton: boolean
	anchor: Anchor
	immersive: boolean
	showSourceLanguage: boolean
	translationColor: string
	autoIncomingImmersive: boolean
	autoChannelIds: string[]
	protectedWords: string[]
	wordLanguageRules: WordRule[]
	saveHistory: boolean
	historyEntries: HistoryEntry[]
	keepMessageTranslations: boolean
	messageTranslations: SavedTranslation[]
}

export const DefaultSettings: Settings = {
	provider: 'google',
	deeplApiKey: '',
	targetOut: 'en',
	sourceOut: 'auto',
	targetIn: 'en',
	favLangs: ['en', 'es', 'fr', 'de', 'ro'],
	rememberLanguagesPerChat: true,
	chatLanguages: {},
	showButton: true,
	draftBeforeSend: true,
	highlightDraftButton: true,
	keepArmed: true,
	hideGiftButton: true,
	anchor: 'actions',
	immersive: true,
	showSourceLanguage: false,
	translationColor: 'default',
	autoIncomingImmersive: true,
	autoChannelIds: [],
	protectedWords: [],
	wordLanguageRules: [],
	saveHistory: true,
	historyEntries: [],
	keepMessageTranslations: true,
	messageTranslations: [],
}

export const MAX_FAVORITES = 5
export const MAX_RULES = 100

/** [code, name, flag]: codes follow Google Translate; DeepL codes are mapped in translate.ts. */
export const LANGUAGES: readonly (readonly [string, string, string?])[] = [
	['en', 'English', '🇺🇸'],
	['ro', 'Romanian', '🇷🇴'],
	['es', 'Spanish', '🇪🇸'],
	['fr', 'French', '🇫🇷'],
	['de', 'German', '🇩🇪'],
	['it', 'Italian', '🇮🇹'],
	['pt', 'Portuguese', '🇧🇷'],
	['ru', 'Russian', '🇷🇺'],
	['uk', 'Ukrainian', '🇺🇦'],
	['pl', 'Polish', '🇵🇱'],
	['nl', 'Dutch', '🇳🇱'],
	['tr', 'Turkish', '🇹🇷'],
	['ar', 'Arabic', '🇸🇦'],
	['he', 'Hebrew', '🇮🇱'],
	['hi', 'Hindi', '🇮🇳'],
	['ja', 'Japanese', '🇯🇵'],
	['ko', 'Korean', '🇰🇷'],
	['zh-CN', 'Chinese (Simplified)', '🇨🇳'],
	['zh-TW', 'Chinese (Traditional)', '🇹🇼'],
	['id', 'Indonesian', '🇮🇩'],
	['th', 'Thai', '🇹🇭'],
	['vi', 'Vietnamese', '🇻🇳'],
	['sv', 'Swedish', '🇸🇪'],
	['da', 'Danish', '🇩🇰'],
	['no', 'Norwegian', '🇳🇴'],
	['fi', 'Finnish', '🇫🇮'],
	['cs', 'Czech', '🇨🇿'],
	['sk', 'Slovak', '🇸🇰'],
	['hu', 'Hungarian', '🇭🇺'],
	['el', 'Greek', '🇬🇷'],
	['bg', 'Bulgarian', '🇧🇬'],
	['sr', 'Serbian', '🇷🇸'],
	['hr', 'Croatian', '🇭🇷'],
	['sl', 'Slovenian', '🇸🇮'],
	['lt', 'Lithuanian', '🇱🇹'],
	['lv', 'Latvian', '🇱🇻'],
	['et', 'Estonian', '🇪🇪'],
	['fa', 'Persian', '🇮🇷'],
	['bn', 'Bengali', '🇧🇩'],
	['ur', 'Urdu', '🇵🇰'],
	['ms', 'Malay', '🇲🇾'],
	['ta', 'Tamil'],
	['te', 'Telugu'],
	['sw', 'Swahili', '🇰🇪'],
	['af', 'Afrikaans', '🇿🇦'],
	['ca', 'Catalan'],
	['tl', 'Filipino', '🇵🇭'],
	['is', 'Icelandic', '🇮🇸'],
	['ga', 'Irish', '🇮🇪'],
	['cy', 'Welsh'],
	['sq', 'Albanian'],
	['mk', 'Macedonian'],
	['ka', 'Georgian'],
	['hy', 'Armenian'],
	['az', 'Azerbaijani'],
	['kk', 'Kazakh'],
	['uz', 'Uzbek'],
	['mn', 'Mongolian'],
	['ne', 'Nepali'],
	['si', 'Sinhala'],
	['my', 'Myanmar'],
	['km', 'Khmer'],
	['lo', 'Lao'],
	['la', 'Latin'],
	['eo', 'Esperanto'],
]

const BY_CODE = new Map(LANGUAGES.map(language => [language[0], language]))

export const isLanguage = (code: unknown): code is string =>
	typeof code === 'string' && BY_CODE.has(code)

export const languageName = (code: string) =>
	code === 'auto' ? 'Auto-detect' : (BY_CODE.get(code)?.[1] ?? code)

export function languageLabel(code: string) {
	const flag = BY_CODE.get(code)?.[2]
	return flag ? `${flag}  ${languageName(code)}` : languageName(code)
}

/** Maps a provider-reported language (`zh-Hans`, `pt_BR`, ...) onto one of our codes. */
export function normalizeLanguage(raw: string | undefined) {
	const value = (raw ?? '').trim().replace(/_/g, '-').toLowerCase()
	if (value === 'zh-tw' || value === 'zh-hant') return 'zh-TW'
	if (value === 'zh' || value === 'zh-cn' || value === 'zh-hans') return 'zh-CN'
	return value.split('-')[0]
}

export function filterLanguages(
	languages: readonly (readonly [string, string, string?])[],
	query: string,
) {
	const needle = query.trim().toLowerCase()
	return needle
		? languages.filter(
				([code, name]) =>
					code.toLowerCase().includes(needle) ||
					name.toLowerCase().includes(needle),
			)
		: languages
}

export const SOURCE_LANGUAGES = [
	['auto', 'Auto-detect'] as const,
	...LANGUAGES,
] as const

interface ColorPreset {
	id: string
	label: string
	/** Discord raw colour family and the shade to prefer. */
	family: string
	shade: number
}

export const COLOR_PRESETS: readonly ColorPreset[] = [
	{ id: 'default', label: 'Default', family: 'BRAND', shade: 360 },
	{ id: 'red', label: 'Red', family: 'RED', shade: 400 },
	{ id: 'orange', label: 'Orange', family: 'ORANGE', shade: 400 },
	{ id: 'yellow', label: 'Yellow', family: 'YELLOW', shade: 300 },
	{ id: 'green', label: 'Green', family: 'GREEN', shade: 360 },
	{ id: 'teal', label: 'Teal', family: 'TEAL', shade: 400 },
	{ id: 'blue', label: 'Blue', family: 'BLUE', shade: 400 },
	{ id: 'purple', label: 'Purple', family: 'PURPLE', shade: 400 },
	{ id: 'pink', label: 'Pink', family: 'PINK', shade: 400 },
	{ id: 'gray', label: 'Gray', family: 'PRIMARY', shade: 400 },
]

/** Looks up the closest shade of a Discord raw colour family, so no hex values are hardcoded. */
function rawColor({ family, shade }: ColorPreset): string | undefined {
	const raw = (Tokens?.RawColor ?? {}) as Record<string, string>
	let best: string | undefined
	let distance = Number.POSITIVE_INFINITY
	for (const name of Object.keys(raw)) {
		const match = new RegExp(`^${family}_(\\d+)$`).exec(name)
		if (!match || typeof raw[name] !== 'string') continue
		const delta = Math.abs(Number(match[1]) - shade)
		if (delta < distance) {
			distance = delta
			best = raw[name]
		}
	}
	return best
}

const HEX = /^#[0-9a-f]{6}$/i

/** Resolves the stored colour (a preset id, or a hex value saved by an earlier version). */
export function resolveColor(value: string): string | undefined {
	if (HEX.test(value)) return value
	const preset = COLOR_PRESETS.find(item => item.id === value)
	return rawColor(preset ?? COLOR_PRESETS[0])
}
