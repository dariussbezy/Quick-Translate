import { getAssetIdByName } from '@valenced/assets'
import { Tokens } from '@valenced/discord/common/tokens'
import { Stores } from '@valenced/discord/flux'
import { after, before } from '@valenced/patcher'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { cloneElement, isValidElement } from 'react'
import { Pressable, View } from 'react-native'
import { getChatLanguages, translateDraft } from './composer'
import { getArmed, pressTranslateSlot, setArmed, useArmed } from './draft'
import { toast } from './env'
import { watchComponent } from './patching'
import { isRunning } from './runtime'
import { ComposerSendSlot } from './send-slot'
import { openTranslateSheet } from './sheets'
import { getSettings, useSettings } from './store'
import type { ComponentType, ReactElement, ReactNode } from 'react'
import type { Ctx } from './patching'
import type { Anchor } from './shared'

const iconId = () =>
	getAssetIdByName('LanguageIcon') ?? getAssetIdByName('GlobeIcon')

/** Whether the Send button should currently turn into the Translate draft button. */
const draftMode = () => {
	const settings = getSettings()
	return !!getArmed() && settings.showButton && settings.draftBeforeSend
}

/** Semantic colors are objects; a tint needs the value for the current theme. */
const brandTint = () =>
	Tokens.default.internal.resolveSemanticColor(
		(Stores.ThemeStore as unknown as { theme: string }).theme,
		Tokens.default.colors.TEXT_BRAND,
	)

let translating = false

async function runDraft(tl: string, sl: string) {
	if (translating) return false
	translating = true
	try {
		return await translateDraft(tl, sl)
	} finally {
		translating = false
	}
}

/** Tap on the translate slot translates the draft; the left button only turns translation off. */
const translateDraftNow = () => void pressTranslateSlot(runDraft)

function toggleTranslation() {
	const settings = getSettings()
	if (getArmed()) {
		setArmed(null)
		return toast('Translation turned off')
	}
	const { targetOut, sourceOut } = getChatLanguages()
	setArmed({ tl: targetOut, sl: sourceOut })
	toast(
		settings.keepArmed
			? 'Translation is active until you turn it off'
			: 'Translation will apply to your next message',
	)
}

const openLanguages = () => openTranslateSheet({ kind: 'draft' })

type Props = Record<string, unknown>

/** Whether an element is a button that carries an icon: a number, a component or an element. */
const hasIcon = (props: Props) =>
	(props.icon != null && typeof props.icon !== 'string') ||
	typeof props.source === 'number' ||
	props.IconComponent != null

/**
 * The translate glyph fills its whole box, while the + and Send glyphs have padding, so at the same
 * size it looks larger. It is scaled down to match them; Discord still sets its size and color.
 */
const GLYPH_SCALE = 0.8

function TranslateGlyph({ style, ...rest }: Props) {
	const Icon = lookupGeneratedIconComponent('LanguageIcon') as
		| ComponentType<Props>
		| undefined
	if (!Icon) return null
	return (
		<Icon {...rest} style={[style, { transform: [{ scale: GLYPH_SCALE }] }]} />
	)
}

/** The props that swap a button's icon for the translate icon, whichever way it was given. */
function iconPatch(props: Props, icon: number): Props {
	if (props.icon != null) return { icon }
	if (typeof props.source === 'number') return { source: icon }
	return { IconComponent: TranslateGlyph }
}

/** The first button with an icon and a press handler in a tree: the + button of the composer. */
function findButton(tree: ReactNode, depth = 0): ReactElement<Props> | null {
	if (depth > 10) return null
	if (Array.isArray(tree)) {
		for (const child of tree) {
			const found = findButton(child, depth + 1)
			if (found) return found
		}
		return null
	}
	if (!isValidElement<Props>(tree)) return null
	if (hasIcon(tree.props) && typeof tree.props.onPress === 'function')
		return tree
	return findButton(tree.props.children as ReactNode, depth + 1)
}

/**
 * The Send button is rebuilt with the translate icon and action while a draft is being translated,
 * so it keeps Discord's exact shape and color. Only the button showing the Send icon is touched.
 */
function swapSend(tree: ReactNode): ReactNode {
	const send = lookupGeneratedIconComponent('SendMessageIcon')
	const translate = lookupGeneratedIconComponent('LanguageIcon')
	if (!send || !translate) return tree
	const visit = (node: ReactNode): ReactNode => {
		if (Array.isArray(node)) return node.map(visit)
		if (!isValidElement<Props>(node)) return node
		if (node.props.IconComponent === send)
			return cloneElement(node, {
				IconComponent: TranslateGlyph,
				accessibilityLabel: 'Translate draft',
				onPress: translateDraftNow,
				onLongPress: openLanguages,
			})
		return node.props.children === undefined
			? node
			: cloneElement(node, {
					children: visit(node.props.children as ReactNode),
				})
	}
	return visit(tree)
}

/**
 * Discord builds the Send button inside a component it does not export, `ChatInputSendButtonInner`.
 * Its elements are only made by the `renderItem` of the transition group in the button's output,
 * so that function is wrapped to reach the component and patch it once.
 */
let patchSendItem: (item: ReactElement) => void = () => {}

function hookItems(tree: ReactNode): ReactNode {
	if (Array.isArray(tree)) return tree.map(hookItems)
	if (!isValidElement<Props>(tree)) return tree
	const { renderItem, children } = tree.props
	if (typeof renderItem === 'function')
		return cloneElement(tree, {
			renderItem: (...args: unknown[]) => {
				const item = (renderItem as (...args: unknown[]) => ReactNode)(...args)
				if (isValidElement(item)) patchSendItem(item)
				return item
			},
		})
	return children === undefined
		? tree
		: cloneElement(tree, { children: hookItems(children as ReactNode) })
}

/** Wraps Discord's Send button so it follows the translation state. */
function SendIconSwap({ children }: { children: ReactNode }) {
	useArmed()
	useSettings()
	return isRunning() && draftMode() ? swapSend(children) : children
}

/** Tap to translate (or arm translation), hold for languages and options. */
function TranslateButton({
	position,
	template,
}: {
	position: Anchor
	template?: ReactElement<Props> | null
}) {
	const settings = useSettings()
	const armed = useArmed()
	const visible =
		isRunning() &&
		settings.showButton &&
		(position === 'actions'
			? settings.anchor === 'actions'
			: settings.anchor === 'send' && !draftMode())
	const icon = iconId()
	if (!visible || !icon) return null
	const label = 'Translate message'

	// The + button of the composer with another icon, so Discord sizes and colors it for every theme.
	if (template)
		return cloneElement(template, {
			key: 'qt-button',
			accessibilityLabel: label,
			...iconPatch(template.props, icon),
			...(armed
				? { active: true, activeIconStyle: { tintColor: brandTint() } }
				: {}),
			onPress: toggleTranslation,
			onLongPress: openLanguages,
		})

	const Icon = lookupGeneratedIconComponent('LanguageIcon')
	const { colors } = Tokens.default
	return (
		// custom: a bare themed icon like the + button, used when that button cannot be reused
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			hitSlop={4}
			onPress={toggleTranslation}
			onLongPress={openLanguages}
			style={{
				width: 32,
				height: 32,
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			{Icon ? (
				<Icon
					size="md"
					color={armed ? colors.TEXT_BRAND : colors.ICON_DEFAULT}
				/>
			) : null}
		</Pressable>
	)
}

/** The slot next to Send, used when the button is placed there. */
function SendSlot({ children }: { children: ReactNode }) {
	return (
		<ComposerSendSlot button={<TranslateButton position="send" />}>
			<SendIconSwap>{hookItems(children)}</SendIconSwap>
		</ComposerSendSlot>
	)
}

function ComposerActionsSlot({ children }: { children: ReactNode }) {
	const settings = useSettings()
	const template = findButton(children)
	if (settings.anchor === 'send' || !settings.showButton) return children
	return (
		// custom: appends the button to Discord's row of composer actions
		<View
			pointerEvents="box-none"
			collapsable={false}
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				overflow: 'visible',
			}}
		>
			{children}
			<TranslateButton position="actions" template={template} />
		</View>
	)
}

/** Puts the Translate button in the composer and hides the Gift button on request. */
export function patchChatBar(ctx: Ctx) {
	const patched = new WeakSet<object>()
	patchSendItem = item => {
		const memo = item.type as { type?: unknown }
		if (typeof memo?.type !== 'function' || patched.has(memo)) return
		patched.add(memo)
		ctx.cleanup(
			after(
				memo as Record<string, (...args: never[]) => unknown>,
				'type',
				ret => (ret ? <SendIconSwap>{ret as ReactNode}</SendIconSwap> : ret),
			),
		)
	}
	ctx.cleanup(() => {
		patchSendItem = () => {}
	})

	const hideGift = (
		target: Record<string, (...args: never[]) => unknown>,
		key: string,
	) =>
		ctx.cleanup(
			before(target, key, args => {
				const [props] = args as unknown as [
					{ shouldShowGiftButton?: boolean } | undefined,
				]
				if (props && getSettings().hideGiftButton)
					props.shouldShowGiftButton = false
				return args
			}),
		)

	watchComponent(ctx, 'ChatInputActions', (target, key) => {
		hideGift(target, key)
		ctx.cleanup(
			after(target, key, ret =>
				ret ? (
					<ComposerActionsSlot>{ret as ReactNode}</ComposerActionsSlot>
				) : (
					ret
				),
			),
		)
	})
	watchComponent(ctx, 'ChatInputRightActions', hideGift)
	watchComponent(ctx, 'ChatInputSendButton', (target, key) =>
		ctx.cleanup(
			after(target, key, ret =>
				ret ? <SendSlot>{ret as ReactNode}</SendSlot> : ret,
			),
		),
	)
}
