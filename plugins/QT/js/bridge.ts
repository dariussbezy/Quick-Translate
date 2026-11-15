import { messageActions } from './menu'
import { getTranslation } from './messages'
import { isRunning } from './runtime'
import { languageName, normalizeLanguage, resolveColor } from './shared'
import { getSettings } from './store'
import { detectLanguage } from './translate'
import type { Message } from './env'

const BRIDGE = '__valencedQuickTranslateTextBridge'
const MAX_DETECTIONS = 100

interface Detection {
	code: string
	name: string
}

/** Used by Voice Messages To Text: language detection and translate actions for transcripts. */
export function installTextBridge() {
	const detections = new Map<string, Detection>()
	const root = globalThis as unknown as Record<string, unknown>

	const bridge = {
		isActive: isRunning,

		async detectLanguage(
			input: string,
			options: { signal?: AbortSignal; automatic?: boolean } = {},
		): Promise<Detection | null> {
			const text = String(input || '')
				.trim()
				.slice(0, 2000)
			if (!isRunning() || options.signal?.aborted || !/\p{L}/u.test(text))
				return null
			// Exact configured phrases resolve short ambiguous transcripts without a request.
			const exact = text
				.toLocaleLowerCase()
				.replace(/[.!?]+$/, '')
				.trim()
			const rule = getSettings().wordLanguageRules.find(
				item =>
					item.word.trim().toLocaleLowerCase() === exact &&
					item.language !== 'auto',
			)
			if (rule)
				return { code: rule.language, name: languageName(rule.language) }
			const known = detections.get(text)
			if (known) return known
			try {
				const code = await detectLanguage(
					text,
					options.signal,
					!!options.automatic,
				)
				if (!code || !isRunning() || options.signal?.aborted) return null
				const detected = { code, name: languageName(code) }
				detections.set(text, detected)
				if (detections.size > MAX_DETECTIONS)
					detections.delete(detections.keys().next().value as string)
				return detected
			} catch {
				return null
			}
		},

		getMessageActions: (message: Message) =>
			isRunning()
				? messageActions(message).filter(action => action.key !== 'qt-bulk')
				: [],

		getMessageTranslation(messageId: string) {
			const saved = getTranslation(String(messageId))
			if (!saved) return null
			const settings = getSettings()
			const source = normalizeLanguage(saved.source)
			return {
				text: saved.translated,
				color: resolveColor(settings.translationColor),
				immersive: saved.autoIncoming
					? settings.autoIncomingImmersive
					: settings.immersive,
				sourceLabel:
					settings.showSourceLanguage && source && source !== 'auto'
						? `${languageName(source)} → ${languageName(saved.target)}`
						: '',
			}
		},
	}

	root[BRIDGE] = bridge
	return () => {
		detections.clear()
		if (root[BRIDGE] === bridge) delete root[BRIDGE]
	}
}
