import { View } from 'react-native'
import { useSettings } from './store'
import type { ReactNode } from 'react'

// custom: Discord's native send button has no slot API, so its layout is wrapped in a plain View.
const rowStyle = {
	flexDirection: 'row',
	alignItems: 'center',
	alignSelf: 'flex-end',
	flexGrow: 0,
	flexShrink: 0,
} as const

/** Hosts the Translate button next to Send. It is bottom-aligned to stay on the last row of a multiline composer. */
export function ComposerSendSlot({
	button,
	children,
}: {
	button: ReactNode
	children: ReactNode
}) {
	const settings = useSettings()
	if (!settings.showButton || settings.anchor !== 'send') return children
	return (
		<View pointerEvents="box-none" style={rowStyle}>
			{button}
			{children}
		</View>
	)
}
