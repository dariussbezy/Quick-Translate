import { getAssetIdByName } from '@valenced/assets'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { before } from '@valenced/patcher'
import { cloneElement, isValidElement } from 'react'
import { openBulkSheet } from './bulk'
import { channelOf, copyText } from './env'
import { placeGroup } from './menu-order'
import {
	getTranslation,
	messageText,
	showOriginal,
	translateMessage,
} from './messages'
import { isRunning } from './runtime'
import { languageName } from './shared'
import { openTranslateSheet } from './sheets'
import { getSettings } from './store'
import type { ReactNode } from 'react'
import type { Message } from './env'
import type { Ctx } from './patching'

export interface MenuAction {
	key: string
	label: string
	press(): void
}

interface VoiceBridge {
	getTranscript?(messageId: string): string | undefined
}

const MENU_KEY = 'MessageLongPressActionSheet'
const BULK_KEY = 'qt-bulk'

const transcriptOf = (id: string) =>
	(
		globalThis as { __valencedVoiceTranscriptBridge?: VoiceBridge }
	).__valencedVoiceTranscriptBridge?.getTranscript?.(id)

/** The translate actions offered for a message (or a voice message transcript). */
export function messageActions(
	message: Message & { __trBase?: unknown },
): MenuAction[] {
	const id = String(message.id)
	const transcript = transcriptOf(id)
	const text =
		transcript ||
		messageText((message.__trBase ?? message.content) as Message['content'])
	if (!text.trim()) return []
	const target =
		!transcript && typeof message.content === 'string'
			? message
			: { ...message, content: text }
	const saved = getTranslation(id)
	const { targetIn } = getSettings()

	const actions: MenuAction[] = [
		saved
			? {
					key: 'qt-original',
					label: 'Show original message',
					press: () => showOriginal(target),
				}
			: {
					key: 'qt-translate',
					label: `Translate to ${languageName(targetIn)}`,
					press: () => void translateMessage(target, targetIn),
				},
	]
	if (channelOf(message))
		actions.push({
			key: BULK_KEY,
			label: 'Bulk translate…',
			press: () => openBulkSheet(target),
		})
	actions.push({
		key: 'qt-translate-to',
		label: 'Translate to...',
		press: () => openTranslateSheet({ kind: 'messages', messages: [target] }),
	})
	if (saved)
		actions.push({
			key: 'qt-copy',
			label: 'Copy translation',
			press: () => copyText(saved.translated),
		})
	return actions
}

type Props = { children?: ReactNode }

/** Adds one group with all translate actions below Forward, without mutating Discord's cached tree. */
function injectActions(
	tree: ReactNode,
	actions: MenuAction[],
	dismiss: () => void,
): ReactNode {
	const group = (
		<Design.ActionSheetRow.Group key="qt-menu">
			{actions.map(action => (
				<Design.ActionSheetRow
					key={action.key}
					label={action.label}
					icon={
						<Design.ActionSheetRow.Icon
							source={getAssetIdByName('LanguageIcon')}
						/>
					}
					onPress={() => {
						dismiss()
						action.press()
					}}
				/>
			))}
		</Design.ActionSheetRow.Group>
	)
	let done = false
	const walk = (node: ReactNode): ReactNode => {
		if (done) return node
		if (Array.isArray(node)) return node.map(walk)
		if (!isValidElement<Props>(node)) return node
		if (node.type === Design.ActionSheet) {
			done = true
			const children = placeGroup(node.props.children, group) ?? [
				...[node.props.children].flat(),
				group,
			]
			return cloneElement(node, { children })
		}
		const children = walk(node.props.children)
		return done ? cloneElement(node, { children }) : node
	}
	return walk(tree)
}

/** Adds the translate actions to the message long-press sheet. */
export function patchMessageMenu({ cleanup }: Ctx) {
	cleanup(
		before(ActionSheetActionCreators, 'openLazy', args => {
			const [sheet, key, context] = args as unknown as [
				Promise<{ default: unknown }>,
				string,
				{ message?: Message },
			]
			if (key !== MENU_KEY || !context?.message || !sheet?.then) return args
			// Voice messages get these actions from Voice Messages To Text.
			if (transcriptOf(String(context.message.id))) return args
			const actions = messageActions(context.message)
			if (!actions.length) return args
			args[0] = sheet.then(module => {
				if (!isRunning() || typeof module.default !== 'function') return module
				const Original = module.default as (props: unknown) => ReactNode
				return {
					...module,
					default: function QuickTranslateMessageActions(props: unknown) {
						return injectActions(Original(props), actions, () =>
							ActionSheetActionCreators.hideActionSheet(key),
						)
					},
				}
			}) as (typeof args)[0]
			return args
		}),
	)
}
