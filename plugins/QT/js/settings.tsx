import { getAssetIdByName } from '@valenced/assets'
import { TableRowAssetIcon } from '@valenced/components'
import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import { useState } from 'react'
import { Linking, ScrollView } from 'react-native'
import manifest from '../manifest.json'
import { setArmed } from './draft'
import { toast } from './env'
import {
	clearTranslationData,
	refreshAll,
	setKeepTranslations,
} from './messages'
import { useGo } from './pages'
import {
	COLOR_PRESETS,
	DEFAULT_GROQ_MODEL,
	DEFAULT_PROVIDER_ORDER,
	languageLabel,
	MAX_FAVORITES,
	usableProviders,
} from './shared'
import { updateSettings, useSettings } from './store'
import type { Anchor, Provider, Settings } from './shared'

const BUILD = manifest.version

type BooleanSetting = {
	[K in keyof Settings]: Settings[K] extends boolean ? K : never
}[keyof Settings]

function Switch({
	name,
	icon,
	label,
	subLabel,
	onChange,
}: {
	name: BooleanSetting
	icon: string
	label: string
	subLabel: string
	onChange?(value: boolean): void
}) {
	const settings = useSettings()
	return (
		<Design.TableSwitchRow
			icon={<TableRowAssetIcon name={icon} />}
			label={label}
			subLabel={subLabel}
			value={settings[name]}
			onValueChange={value => {
				updateSettings({ [name]: value })
				onChange?.(value)
			}}
		/>
	)
}

const GROQ_KEYS_URL = 'https://console.groq.com/keys'
const GROQ_STEPS = [
	'1. Open console.groq.com and sign up. It is free, and Google or GitHub sign-in works.',
	'2. Open API Keys in the menu and tap Create API Key. Give it any name.',
	'3. Copy the key (it starts with gsk_) right away: Groq shows it only once.',
	'4. Paste it into the Groq API key field above. Groq AI then joins the service list.',
	'The free plan has rate limits: when they are reached, the next service in the list is used.',
].join('\n')

const SERVICES: Record<
	Provider,
	{ icon: string; label: string; hint: string }
> = {
	deepl: { icon: 'KeyIcon', label: 'DeepL', hint: 'Needs your DeepL API key' },
	groq: {
		icon: 'SparkleIcon',
		label: 'Groq AI',
		hint: 'AI translation, needs your Groq API key',
	},
	google: {
		icon: 'LanguageIcon',
		label: 'Google Translate',
		hint: 'No key needed',
	},
	microsoft: {
		icon: 'LanguageIcon',
		label: 'Microsoft Translator',
		hint: 'No key needed',
	},
}

/** The services in the order they are tried, with arrows to move each one. */
function ServiceOrder() {
	const settings = useSettings()
	const order = settings.providerOrder
	const usable = usableProviders(settings)
	const move = (index: number, by: number) => {
		const next = [...order]
		const [item] = next.splice(index, 1)
		next.splice(index + by, 0, item)
		updateSettings({ providerOrder: next })
	}
	return (
		<Design.TableRowGroup
			title="Translation services"
			description="Tried from top to bottom: when one fails or is paused, the next one is used. A service that needs a key is skipped until you add it below."
		>
			{order.map((provider, index) => {
				const info = SERVICES[provider]
				const ready = usable.includes(provider)
				return (
					<Design.TableRow
						key={provider}
						icon={<TableRowAssetIcon name={info.icon} />}
						label={`${index + 1}. ${info.label}`}
						subLabel={
							ready
								? `${info.hint}${usable[0] === provider ? ' · used first' : ''}`
								: `${info.hint} · skipped, add the key below`
						}
						trailing={
							// custom: two small arrow buttons to reorder the list
							<Design.Stack direction="horizontal" spacing={8}>
								<Design.IconButton
									icon={getAssetIdByName('ArrowSmallUpIcon')!}
									size="sm"
									variant="secondary"
									disabled={index === 0}
									accessibilityLabel={`Move ${info.label} up`}
									onPress={() => move(index, -1)}
								/>
								<Design.IconButton
									icon={getAssetIdByName('ArrowSmallDownIcon')!}
									size="sm"
									variant="secondary"
									disabled={index === order.length - 1}
									accessibilityLabel={`Move ${info.label} down`}
									onPress={() => move(index, 1)}
								/>
							</Design.Stack>
						}
					/>
				)
			})}
			<Design.TableRow
				icon={<TableRowAssetIcon name="RefreshIcon" />}
				label="Reset order"
				subLabel="Services with a key first, then Google Translate, then Microsoft Translator."
				onPress={() =>
					updateSettings({ providerOrder: [...DEFAULT_PROVIDER_ORDER] })
				}
			/>
		</Design.TableRowGroup>
	)
}

const GUIDE: readonly (readonly [string, string, string])[] = [
	[
		'Translate a message',
		'LanguageIcon',
		'Long-press a message to translate it, view the original, or open more translation actions.',
	],
	[
		'Translate a draft',
		'PencilIcon',
		'Tap the Translate button in the composer to translate what you are typing. Select part of the draft first to translate only that part. With Translate before sending on, Send turns into Translate and a second tap sends. Hold the button for languages and options.',
	],
	[
		'Pick a service and languages',
		'SettingsIcon',
		'Order the services as you like: DeepL and Groq AI use your own API key, Google Translate and Microsoft Translator need none. When one fails, the next is used. Then set separate languages for your outgoing and incoming messages.',
	],
	[
		'Automatic translation',
		'BellIcon',
		'Select the channels and DMs where new incoming messages should be translated automatically.',
	],
	[
		'History and comparing',
		'ClockIcon',
		'Translation history keeps your translations. Compare a translation with another service, copy it, or jump to its message.',
	],
	[
		'Protect words',
		'LockIcon',
		'Protected words, such as names or terms, are never translated.',
	],
]

type Tab = 'general' | 'languages' | 'more'
const TABS: readonly (readonly [Tab, string])[] = [
	['general', 'General'],
	['languages', 'Languages'],
	['more', 'History & help'],
]

export default function SettingsComponent() {
	const settings = useSettings()
	const [tab, setTab] = useState<Tab>('general')
	const go = useGo()
	const color = COLOR_PRESETS.find(
		preset => preset.id === settings.translationColor,
	)

	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			<Page>
				<Design.Stack spacing={24}>
					<Design.Stack direction="horizontal" spacing={8}>
						{TABS.map(([id, label]) => (
							<Design.Button
								key={id}
								text={label}
								size="sm"
								grow
								variant={tab === id ? 'primary' : 'secondary'}
								onPress={() => setTab(id)}
							/>
						))}
					</Design.Stack>
					{tab === 'general' && (
						<Design.Stack spacing={24}>
							<ServiceOrder />
							<Design.Stack spacing={8}>
								<Design.TextInput
									label="DeepL API key"
									description="Optional. Stored in this plugin’s local settings. Free API keys ending in :fx are supported."
									placeholder="Paste your API key"
									secureTextEntry
									defaultValue={settings.deeplApiKey}
									onChange={deeplApiKey =>
										updateSettings({ deeplApiKey: deeplApiKey.trim() })
									}
								/>
								<Design.TextInput
									label="Groq API key"
									description="Optional. Enables AI translation with Groq. The text you translate is sent to Groq. The key is stored in this plugin’s local settings."
									placeholder="gsk_…"
									secureTextEntry
									defaultValue={settings.groqApiKey}
									onChange={groqApiKey =>
										updateSettings({ groqApiKey: groqApiKey.trim() })
									}
								/>
							</Design.Stack>
							<Design.TableRowGroup title="Get a free Groq API key">
								<Design.TableRow
									icon={<TableRowAssetIcon name="CircleInformationIcon" />}
									label="Steps"
									subLabel={GROQ_STEPS}
									subLabelLineClamp={12}
								/>
								<Design.TableRow
									icon={<TableRowAssetIcon name="LinkIcon" />}
									label="Open the Groq console"
									subLabel="console.groq.com/keys"
									arrow
									onPress={() => void Linking.openURL(GROQ_KEYS_URL)}
								/>
							</Design.TableRowGroup>
							<Design.TextInput
								label="Groq model"
								description={`The AI model used for translation. Leave ${DEFAULT_GROQ_MODEL} unless Groq retires it or you prefer another model from its model list.`}
								placeholder={DEFAULT_GROQ_MODEL}
								defaultValue={settings.groqModel}
								onChange={groqModel =>
									updateSettings({ groqModel: groqModel.trim() })
								}
							/>
						</Design.Stack>
					)}
					{tab === 'languages' && (
						<Design.TableRowGroup title="Words">
							<Design.TableRow
								icon={<TableRowAssetIcon name="LockIcon" />}
								label="Keep words unchanged"
								subLabel={`${settings.protectedWords.length} words`}
								arrow
								onPress={() => go('words', 'Keep words unchanged')}
							/>
							<Design.TableRow
								icon={<TableRowAssetIcon name="LanguageIcon" />}
								label="Word language rules"
								subLabel={`${settings.wordLanguageRules.length} rules · Auto-detect only`}
								arrow
								onPress={() => go('rules', 'Word language rules')}
							/>
						</Design.TableRowGroup>
					)}
					{tab === 'languages' && (
						<Design.TableRowGroup title="Languages">
							<Design.TableRow
								icon={<TableRowAssetIcon name="ArrowAngleRightUpIcon" />}
								label="Translate my messages to"
								subLabel={languageLabel(settings.targetOut)}
								arrow
								onPress={() =>
									go('language', 'Translate my messages to', {
										field: 'targetOut',
									})
								}
							/>
							<Design.TableRow
								icon={<TableRowAssetIcon name="PencilIcon" />}
								label="My messages are written in"
								subLabel={languageLabel(settings.sourceOut)}
								arrow
								onPress={() =>
									go('language', 'My messages are written in', {
										field: 'sourceOut',
										withAuto: true,
									})
								}
							/>
							<Design.TableRow
								icon={<TableRowAssetIcon name="ArrowAngleLeftUpIcon" />}
								label="Quick translate messages to"
								subLabel={languageLabel(settings.targetIn)}
								arrow
								onPress={() =>
									go('language', 'Quick translate messages to', {
										field: 'targetIn',
									})
								}
							/>
							<Design.TableRow
								icon={<TableRowAssetIcon name="StarIcon" />}
								label="Quick languages"
								subLabel={`${settings.favLangs.length} of ${MAX_FAVORITES} selected`}
								arrow
								onPress={() => go('quick', 'Quick languages')}
							/>
						</Design.TableRowGroup>
					)}
					{tab === 'general' && (
						<Design.Stack spacing={8}>
							<Design.TableRowGroup title="Chat composer">
								<Switch
									name="showButton"
									icon="LanguageIcon"
									label="Show translate button"
									subLabel="Show the translate control in the chat composer."
									onChange={value => value || setArmed(null)}
								/>
								<Switch
									name="translateSelection"
									icon="PencilIcon"
									label="Translate selected text only"
									subLabel="When part of a draft is selected, translate just that part and leave the rest as typed."
								/>
								<Switch
									name="draftBeforeSend"
									icon="ChatMarkUnreadIcon"
									label="Translate before sending"
									subLabel="Send becomes Translate; tap again to send."
									onChange={() => setArmed(null)}
								/>
								<Switch
									name="highlightDraftButton"
									icon="PaintPaletteIcon"
									label="Highlight Translate Draft button"
									subLabel="Use a blue Send-style button for Translate Draft."
								/>
								<Switch
									name="rememberLanguagesPerChat"
									icon="ChatMarkUnreadIcon"
									label="Remember language per chat"
									subLabel="Store each chat’s default language separately."
								/>
								<Switch
									name="keepArmed"
									icon="SettingsIcon"
									label="Keep translate active"
									subLabel="In normal mode, keep translating sent messages until you turn it off."
								/>
								<Switch
									name="hideGiftButton"
									icon="GiftIcon"
									label="Hide Gift button"
									subLabel="Hide the Gift button in the chat composer."
									onChange={() =>
										toast('Restart Discord to apply this setting')
									}
								/>
							</Design.TableRowGroup>
							<Design.TableRadioGroup<Anchor>
								title="Button position"
								description="With the button next to Send, hold it and tap Turn off Translate to stop translating."
								value={settings.anchor}
								onChange={anchor => updateSettings({ anchor })}
							>
								<Design.TableRadioRow
									value="actions"
									label="Next to the + button"
								/>
								<Design.TableRadioRow
									value="send"
									label="Next to the Send button"
								/>
							</Design.TableRadioGroup>
						</Design.Stack>
					)}
					{tab === 'general' && (
						<Design.TableRowGroup title="Appearance">
							<Switch
								name="immersive"
								icon="PencilIcon"
								label="Immersive translation"
								subLabel="Show the translation below the original message. Turn off to replace its text."
								onChange={refreshAll}
							/>
							<Switch
								name="showSourceLanguage"
								icon="LanguageIcon"
								label="Show detected source language"
								subLabel="Show a compact source → target line below the translation."
								onChange={refreshAll}
							/>
							<Design.TableRow
								icon={<TableRowAssetIcon name="PaintPaletteIcon" />}
								label="Translation color"
								trailing={
									<Design.TableRow.TrailingText
										text={color?.label ?? 'Custom'}
									/>
								}
								arrow
								onPress={() => go('color', 'Translation color')}
							/>
						</Design.TableRowGroup>
					)}
					{tab === 'more' && (
						<Design.TableRowGroup title="Incoming messages">
							<Switch
								name="autoIncomingImmersive"
								icon="BellIcon"
								label="Immersive auto-translate"
								subLabel="Show auto-translations below the original."
								onChange={refreshAll}
							/>
							<Design.TableRow
								icon={<TableRowAssetIcon name="ChatMarkUnreadIcon" />}
								label="Automatic channels and DMs"
								subLabel={`${settings.autoChannelIds.length} selected`}
								arrow
								onPress={() => go('channels', 'Automatic channels and DMs')}
							/>
						</Design.TableRowGroup>
					)}
					{tab === 'more' && (
						<Design.TableRowGroup
							title="Translation history & cache"
							description="Clearing removes saved history, message translations and cached results."
						>
							<Switch
								name="saveHistory"
								icon="ClockIcon"
								label="Save translation history"
								subLabel="Store translated messages and drafts locally in Translation history."
							/>
							<Design.TableSwitchRow
								icon={<TableRowAssetIcon name="ClipboardListIcon" />}
								label="Keep translations after restart"
								subLabel="Restore saved translations when Discord restarts."
								value={settings.keepMessageTranslations}
								onValueChange={setKeepTranslations}
							/>
							<Design.TableRow
								icon={<TableRowAssetIcon name="ClockIcon" />}
								label="Translation history"
								subLabel={`${settings.historyEntries.length} saved locally`}
								arrow
								onPress={() => go('history', 'Translation history')}
							/>
							<Design.TableRow
								variant="danger"
								icon={<TableRowAssetIcon variant="danger" name="TrashIcon" />}
								label="Clear translation history & cache"
								onPress={clearTranslationData}
							/>
						</Design.TableRowGroup>
					)}
					{tab === 'more' && (
						<Design.TableRowGroup title="Quick guide">
							{GUIDE.map(([label, icon, subLabel]) => (
								<Design.TableRow
									key={label}
									icon={<TableRowAssetIcon name={icon} />}
									label={label}
									subLabel={subLabel}
									subLabelLineClamp={12}
								/>
							))}
						</Design.TableRowGroup>
					)}
					<Design.Text
						variant="text-xs/normal"
						color="text-muted"
						style={{ textAlign: 'center' }}
					>
						Quick Translate {BUILD}
					</Design.Text>
				</Design.Stack>
			</Page>
		</ScrollView>
	)
}
