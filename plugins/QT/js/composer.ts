import { before, instead } from '@valenced/patcher'
import { TextInput } from 'react-native'
import { getArmed, setArmed } from './draft'
import {
	currentChannelId,
	findByProps,
	getChannel,
	getUser,
	isDM,
	toast,
	userName,
} from './env'
import { assertCurrent, currentGeneration, isRunning } from './runtime'
import { languageName } from './shared'
import { getSettings, updateSettings } from './store'
import { notifyTranslated, translate } from './translate'
import type { ChatLanguages } from './shared'

type Change = (text: string) => void
interface InputInstance {
	setNativeProps?(props: { text: string }): void
}
/** Discord's chat input ref; the exposed methods differ between builds. */
interface ComposerRef {
	getText?(): string
	getValue?(): string
	text?: string
	value?: string
	props?: { value?: string }
	setText?(text: string): void
	setValue?(text: string): void
	setNativeProps?(props: { text: string }): void
	clear?(): void
	insertText?(text: string): void
}

/** The chat TextInput as last rendered: its current text, change handler and native instance. */
const input: {
	text: string
	change: Change | null
	instance: InputInstance | null
	seen: number
	/** The part of the draft the user has selected, if any. */
	selection: { start: number; end: number } | null
} = {
	text: '',
	change: null,
	instance: null,
	seen: 0,
	selection: null,
}
let lastOriginal: { text: string; channelId: string | null } | null = null
let lastChannelId: string | null = null
const refWrappers = new WeakMap<
	object,
	(instance: InputInstance | null) => void
>()

export const hasRestorableDraft = () => lastOriginal !== null

/** The selected part of the draft, when the setting is on and the selection still fits the text. */
function selectedRange(text: string) {
	const range = input.selection
	if (!getSettings().translateSelection || !range) return null
	if (range.end <= range.start || range.end > text.length) return null
	if (!text.slice(range.start, range.end).trim()) return null
	return range
}

export const hasSelection = () => selectedRange(readInput()) !== null

/* ----------------------------- per-chat languages ---------------------------- */

export function getChatLanguages(
	channelId = currentChannelId(),
): ChatLanguages {
	const settings = getSettings()
	const stored =
		channelId && settings.rememberLanguagesPerChat
			? settings.chatLanguages[channelId]
			: undefined
	return {
		sourceOut: stored?.sourceOut || settings.sourceOut || 'auto',
		targetOut: stored?.targetOut || settings.targetOut || 'en',
	}
}

export function saveChatLanguages(
	channelId: string | null,
	patch: Partial<ChatLanguages>,
) {
	const settings = getSettings()
	if (!channelId || !settings.rememberLanguagesPerChat)
		return updateSettings(patch)
	updateSettings({
		chatLanguages: {
			...settings.chatLanguages,
			[channelId]: { ...getChatLanguages(channelId), ...patch },
		},
	})
}

/* -------------------------------- input bridge -------------------------------- */

function isChatInput(props: Record<string, unknown>) {
	const placeholder =
		typeof props.placeholder === 'string' ? props.placeholder : ''
	if (
		/^(message|mesaj|mensaje|nachricht|messag|написать|сообщение)/i.test(
			placeholder,
		)
	)
		return true
	const channel = getChannel(currentChannelId())
	if (!channel) return false
	const name = isDM(channel)
		? channel.name || userName(getUser(channel.recipients?.[0] ?? ''))
		: channel.name
	if (
		name &&
		name !== 'Unknown' &&
		placeholder.toLowerCase().includes(name.toLowerCase())
	)
		return true
	// Discord's composer is a multiline, send-enabled input, including in DMs where the placeholder may be omitted.
	return (
		!!props.multiline &&
		typeof props.onChangeText === 'function' &&
		(typeof props.onSubmitEditing === 'function' ||
			props.returnKeyType === 'send' ||
			props.maxLength === 2000)
	)
}

/** Captures the chat TextInput's value, change handler and instance. */
export function patchTextInput() {
	const target = TextInput as unknown as {
		render?: (...args: unknown[]) => unknown
	}
	if (typeof target.render !== 'function') return () => {}
	return before(
		target as Record<string, (...args: unknown[]) => unknown>,
		'render',
		args => {
			const [props, ref] = args as [
				Record<string, unknown> | undefined,
				unknown,
			]
			if (!props || !isChatInput(props)) return args
			input.seen = Date.now()
			const original =
				typeof props.onChangeText === 'function'
					? (props.onChangeText as Change)
					: null
			input.change = original
			if (typeof props.value === 'string') input.text = props.value
			const holder =
				ref && typeof ref === 'object' ? (ref as { current: unknown }) : null
			let wrapped = holder ? refWrappers.get(holder) : undefined
			if (!wrapped) {
				wrapped = instance => {
					input.instance = instance
					if (typeof ref === 'function') ref(instance)
					else if (holder) holder.current = instance
				}
				if (holder) refWrappers.set(holder, wrapped)
			}
			const originalSelection =
				typeof props.onSelectionChange === 'function'
					? (props.onSelectionChange as (event: unknown) => void)
					: null
			return [
				{
					...props,
					onChangeText: (text: string) => {
						input.text = text
						// Offsets of an earlier selection no longer match the new text.
						input.selection = null
						original?.(text)
					},
					onSelectionChange: (event: {
						nativeEvent?: { selection?: { start?: number; end?: number } }
					}) => {
						const range = event?.nativeEvent?.selection
						input.selection =
							typeof range?.start === 'number' &&
							typeof range.end === 'number' &&
							range.end > range.start
								? { start: range.start, end: range.end }
								: null
						originalSelection?.(event)
					},
				},
				wrapped,
			]
		},
	)
}

const composerRef = () => {
	const channelId = currentChannelId()
	const api = findByProps<{
		getChatInputRef?(channelId: string, index: number): ComposerRef | undefined
	}>('getChatInputRef')
	return channelId ? api?.getChatInputRef?.(channelId, 0) : undefined
}

function readInput() {
	if (Date.now() - input.seen < 600000 && input.text.trim()) return input.text
	const ref = composerRef()
	return (
		ref?.getText?.() ??
		ref?.getValue?.() ??
		ref?.text ??
		ref?.value ??
		ref?.props?.value ??
		''
	)
}

function writeInput(text: string) {
	let ok = false
	try {
		if (input.change) {
			input.change(text)
			ok = true
		}
		if (input.instance?.setNativeProps) {
			input.instance.setNativeProps({ text })
			ok = true
		}
	} catch {
		// fall through to Discord's own composer ref
	}
	if (!ok) {
		const ref = composerRef()
		try {
			if (ref?.setText) ref.setText(text)
			else if (ref?.setValue) ref.setValue(text)
			else if (ref?.setNativeProps) ref.setNativeProps({ text })
			else if (ref?.clear && ref.insertText) {
				ref.clear()
				ref.insertText(text)
			} else return false
			ok = true
		} catch {
			return false
		}
	}
	input.text = text
	input.selection = null
	return true
}

function resetInput() {
	input.text = ''
	input.selection = null
	input.change = null
	input.instance = null
	input.seen = 0
}

/** Forgets the draft state; used when the plugin stops. */
export function resetComposer() {
	resetInput()
	lastOriginal = null
	lastChannelId = null
}

/** Remembers the open chat, so only real chat switches count as changes. */
export function trackChannel() {
	lastChannelId = currentChannelId()
}

/** Called when the user opens another chat. */
export function onChannelChanged(channelId: string | null) {
	if (channelId === lastChannelId) return
	lastChannelId = channelId
	resetInput()
	if (lastOriginal && lastOriginal.channelId !== channelId) lastOriginal = null
	setArmed(null)
}

/* ---------------------------- translating the draft --------------------------- */

export async function translateDraft(tl: string, sl: string) {
	const text = readInput()
	if (!text.trim()) {
		toast('Type a message in the chat box first')
		return false
	}
	if (!(input.change || input.instance || composerRef())) {
		toast(
			'Discord could not access the message box; reopen the chat and try again',
		)
		return false
	}
	const channelId = currentChannelId()
	// With part of the draft selected, only that part is translated and the rest stays as typed.
	const range = selectedRange(text)
	const part = range ? text.slice(range.start, range.end) : text
	const lead = range ? (/^\s*/.exec(part)?.[0] ?? '') : ''
	const trail = range ? (/\s*$/.exec(part)?.[0] ?? '') : ''
	try {
		const result = await translate(part.trim(), tl, sl, { channelId })
		if (
			!isRunning() ||
			currentChannelId() !== channelId ||
			readInput() !== text
		) {
			toast(
				'The draft or conversation changed; the original text was left untouched',
			)
			return false
		}
		if (result.same) {
			setArmed(null)
			toast(`Already in ${languageName(tl)}`)
			return false
		}
		const next = range
			? text.slice(0, range.start) +
				lead +
				result.text +
				trail +
				text.slice(range.end)
			: result.text
		if (!writeInput(next)) {
			toast('Could not update the chat box; the original text is unchanged')
			return false
		}
		lastOriginal = { text, channelId }
		notifyTranslated(result, !!range)
		return true
	} catch (error) {
		toast(`Translation failed: ${(error as Error)?.message ?? error}`)
		return false
	}
}

export function restoreOriginal() {
	if (!lastOriginal) return toast('Nothing to restore')
	if (lastOriginal.channelId && currentChannelId() !== lastOriginal.channelId)
		return toast('Open the original conversation before restoring this draft')
	if (writeInput(lastOriginal.text)) lastOriginal = null
	else toast('Could not write to the chat box')
}

/* ------------------------------- sending messages ------------------------------ */

interface OutgoingMessage {
	content?: unknown
}

/** With "Translate before sending" off, the active languages are applied to the message on send. */
export function patchSend(
	messages: Record<string, (...args: unknown[]) => unknown>,
) {
	return instead(messages, 'sendMessage', (args, original) => {
		const since = currentGeneration()
		const [channelId, message] = args as [string, OutgoingMessage | undefined]
		const job = getSettings().draftBeforeSend ? null : getArmed()
		let translated = false
		let pending: Promise<void> | undefined

		if (job && typeof message?.content === 'string' && message.content.trim()) {
			if (!job.oneShot && !getSettings().keepArmed) setArmed(null)
			pending = translate(message.content, job.tl, job.sl, {
				channelId: currentChannelId(),
			}).then(result => {
				if (result.same) return
				args[1] = { ...message, content: result.text }
				notifyTranslated(result)
				translated = true
			})
		}

		const send = () => {
			assertCurrent(since)
			const afterSend = () => {
				if (
					lastOriginal &&
					(channelId === lastOriginal.channelId ||
						currentChannelId() === lastOriginal.channelId)
				)
					lastOriginal = null
				input.text = ''
				if (job?.oneShot && translated) setArmed(job.resume ?? null)
			}
			const result = original(...args)
			if (result instanceof Promise)
				return result.then(value => {
					afterSend()
					return value
				})
			afterSend()
			return result
		}

		return pending
			? pending
					.catch(() => toast('Translation failed, sent the original message'))
					.then(send)
			: send()
	})
}
