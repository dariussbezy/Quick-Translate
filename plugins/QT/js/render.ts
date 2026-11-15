import { withName } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { processColor } from 'react-native'
import { toast } from './env'
import { consumeStale, getTranslation, hasTranslation } from './messages'
import { watch } from './patching'
import { languageName, normalizeLanguage, resolveColor } from './shared'
import { getSettings } from './store'
import type { Message, MessageNode } from './env'
import type { Ctx } from './patching'

const INLINE = new Set([
	'text',
	'strong',
	'em',
	'u',
	's',
	'inlineCode',
	'customEmoji',
])

/** Original content we replaced, kept on the message copy so a row can be decorated again. */
type Decorated = Message & {
	__trBase?: MessageNode[]
	__trBaseRaw?: Message['content']
	__trOut?: MessageNode[]
}

interface Row {
	type?: number
	rowType?: number
	changeType?: number
	message?: Decorated
}

interface VoiceBridge {
	handlesInline?(messageId: string): boolean
}

/** Drops nodes this plugin added, and any parent left empty by that. */
function stripOurs(nodes: MessageNode[]): MessageNode[] {
	const out: MessageNode[] = []
	for (const node of nodes) {
		if (node?.__tr) continue
		if (Array.isArray(node?.content)) {
			const inner = stripOurs(node.content)
			if (!inner.length && node.content.length) continue
			out.push(
				inner.length === node.content.length
					? node
					: { ...node, content: inner },
			)
		} else out.push(node)
	}
	return out
}

/** The translation as message nodes; custom emoji stay real emoji. */
function translatedNodes(value: string) {
	const nodes: MessageNode[] = []
	let last = 0
	for (const match of value.matchAll(/<(a?):([\w~]+):(\d+)>/g)) {
		if (match.index > last)
			nodes.push({
				type: 'text',
				content: value.slice(last, match.index),
				__tr: true,
			})
		const [, animated, alt, id] = match
		const webp = `https://cdn.discordapp.com/emojis/${id}.webp?size=128`
		nodes.push({
			type: 'customEmoji',
			id,
			alt,
			src: animated ? webp.replace('.webp', '.gif') : webp,
			frozenSrc: webp,
		})
		last = match.index + match[0].length
	}
	if (last < value.length || !nodes.length)
		nodes.push({ type: 'text', content: value.slice(last), __tr: true })
	return nodes
}

/** Colours the nodes through a link span; the actionless target keeps it from opening anything. */
function paint(nodes: MessageNode[], color: number | undefined) {
	if (!color) return nodes
	return [
		{
			type: 'link',
			target: { linkColor: color, medium: false },
			linkColor: color,
			content: nodes.filter(node => INLINE.has(node.type)),
		},
	]
}

/** A small "-#" line, built as the block-level node Discord's markdown produces. */
const subtext = (label: string): MessageNode[] => [
	{
		type: 'subtext',
		content: [{ type: 'text', content: label, __tr: true }],
		__tr: true,
	},
]

function toNodes(
	content: Message['content'] | null | undefined,
): MessageNode[] {
	if (Array.isArray(content)) return stripOurs(content)
	return typeof content === 'string' && content.trim()
		? [{ type: 'text', content }]
		: []
}

function decorate(row: Row, hint: number | undefined) {
	const message = row.message
	if (!message || (row.type ?? hint ?? row.rowType) !== 1) return
	const id = String(message.id)
	// Voice transcripts and their translations share the block below the audio.
	if (
		(
			globalThis as { __valencedVoiceTranscriptBridge?: VoiceBridge }
		).__valencedVoiceTranscriptBridge?.handlesInline?.(id)
	)
		return

	const saved = getTranslation(id)
	const ours =
		message.__trOut !== undefined && message.content === message.__trOut
	const original = ours
		? message.__trBaseRaw !== undefined
			? message.__trBaseRaw
			: message.__trBase
		: message.content

	if (!saved) {
		if (ours) {
			message.content = original as Message['content']
			message.__trBaseRaw = undefined
			message.__trBase = undefined
			message.__trOut = undefined
		} else if (Array.isArray(message.content)) {
			const clean = stripOurs(message.content)
			if (clean.length !== message.content.length) message.content = clean
		}
		return
	}

	const settings = getSettings()
	const base = ours
		? (message.__trBase as MessageNode[])
		: toNodes(message.content)
	const color = processColor(resolveColor(settings.translationColor)) as
		| number
		| undefined
	const text = paint(translatedNodes(saved.translated), color)
	const code = normalizeLanguage(saved.source)
	const source =
		settings.showSourceLanguage && code && code !== 'auto'
			? subtext(`${languageName(code)} → ${languageName(saved.target)}`)
			: []
	const immersive = saved.autoIncoming
		? settings.autoIncomingImmersive
		: settings.immersive
	const out = immersive
		? [...base, { type: 'text', content: '\n', __tr: true }, ...source, ...text]
		: [...source, ...text]

	message.__trBaseRaw = original as Message['content']
	message.__trBase = base
	message.__trOut = out
	message.content = out
}

/** Shows translations in the chat by decorating the rows Discord generates for messages. */
export function patchRows(ctx: Ctx) {
	let errors = 0
	watch<{ prototype?: object; default?: { prototype?: object } }>(
		ctx,
		withName('RowManager'),
		manager => {
			const target = (manager.prototype ?? manager.default?.prototype) as
				| Record<string, (...args: never[]) => unknown>
				| undefined
			if (typeof target?.generate !== 'function')
				throw new Error('Quick Translate: RowManager.generate is unavailable')
			const unpatch = instead(target, 'generate', function (
				this: unknown,
				args: unknown[],
				original: (...args: unknown[]) => unknown,
			) {
				const row = Reflect.apply(original, this, args) as Row | undefined
				if (!row?.message) return row
				// Never mutate a cached message owned by Discord.
				const output: Row = { ...row, message: { ...row.message } }
				try {
					const hint = (args[0] as Row | undefined)?.rowType
					decorate(output, hint)
					if ((row.type ?? hint ?? row.rowType) === 1) {
						const id = String(row.message.id)
						// Native Discord skips unchanged records unless the row is explicitly rebound.
						if (consumeStale(id) || hasTranslation(id)) output.changeType = 2
					}
					return output
				} catch (error) {
					if (++errors >= 3) {
						unpatch()
						toast(
							'Quick Translate: message styling disabled after repeated errors',
						)
					}
					ctx.report(error)
					return row
				}
			} as never)
			ctx.cleanup(unpatch)
		},
	)
}
