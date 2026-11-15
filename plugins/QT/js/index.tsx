import { onFluxEventDispatched } from '@valenced/discord/flux'
import { withProps } from '@valenced/modules/finders/filters'
import { installTextBridge } from './bridge'
import { patchChatBar } from './chat-bar'
import {
	onChannelChanged,
	patchSend,
	patchTextInput,
	resetComposer,
	trackChannel,
} from './composer'
import { setArmed } from './draft'
import { resetModuleCache } from './env'
import { patchMessageMenu } from './menu'
import {
	loadTranslations,
	onIncomingMessage,
	unloadTranslations,
} from './messages'
import { registerPages } from './pages'
import { watch } from './patching'
import { patchRows } from './render'
import { startRuntime } from './runtime'
import SettingsComponent from './settings'
import { DefaultSettings } from './shared'
import { initStore } from './store'
import type { Message } from './env'
import type { Ctx } from './patching'
import type { Settings } from './shared'

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	async start({ cleanup, jsonStorage, plugin: self }) {
		const ctx: Ctx = { cleanup, report: error => self.reportError(error) }

		cleanup(await initStore(jsonStorage))
		resetModuleCache()
		cleanup(startRuntime(), resetComposer, () => setArmed(null))
		trackChannel()

		loadTranslations()
		cleanup(unloadTranslations, installTextBridge())

		cleanup(
			onFluxEventDispatched('CHANNEL_SELECT', payload => {
				onChannelChanged(
					payload.channelId != null ? String(payload.channelId) : null,
				)
				return payload
			}),
			onFluxEventDispatched<{ message?: Message; channelId?: string }>(
				'MESSAGE_CREATE',
				payload => {
					// Incoming translation must never affect message delivery.
					try {
						onIncomingMessage(payload)
					} catch (error) {
						ctx.report(error)
					}
					return payload
				},
			),
			patchTextInput(),
		)
		watch<Record<string, (...args: unknown[]) => unknown>>(
			ctx,
			withProps('sendMessage', 'receiveMessage'),
			messages => cleanup(patchSend(messages)),
		)

		patchRows(ctx)
		patchMessageMenu(ctx)
		patchChatBar(ctx)
		registerPages(ctx)

		if (self.startedLate) self.requireReload()
	},
	SettingsComponent,
})
