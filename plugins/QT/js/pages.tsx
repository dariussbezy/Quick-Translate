import { getAssetIdByName } from '@valenced/assets'
import { SearchInput, TableRowAssetIcon } from '@valenced/components'
import Page from '@valenced/components/Page'
import { Design } from '@valenced/discord/design'
import {
	onSettingsModulesLoaded,
	refreshSettings,
	registerSettingsItem,
} from '@valenced/discord/modules/settings'
import { ReactNavigationNative } from '@valenced/externals/react-navigation'
import { createElement, useLayoutEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import {
	channelLabel,
	copyText,
	dmName,
	findByProps,
	getChannel,
	guildChannels,
	guilds,
	isDM,
	privateChannelIds,
	toast,
} from './env'
import { deleteHistoryEntry, refreshAll } from './messages'
import {
	COLOR_PRESETS,
	filterLanguages,
	isLanguage,
	LANGUAGES,
	languageLabel,
	MAX_FAVORITES,
	MAX_RULES,
	ProviderLabels,
	resolveColor,
	SOURCE_LANGUAGES,
} from './shared'
import { getSettings, updateSettings, useSettings } from './store'
import { translateWith } from './translate'
import type { ComponentType } from 'react'
import type { Ctx } from './patching'
import type { HistoryEntry, Provider } from './shared'

/** The service used for the comparison: DeepL when it is set up, otherwise Microsoft; Google for the rest. */
const otherProvider = (provider: Provider): Provider =>
	provider !== 'google'
		? 'google'
		: getSettings().deeplApiKey.trim()
			? 'deepl'
			: 'microsoft'

const ROUTE = 'DariussQuickTranslatePage'
const MAX_PROTECTED = 100

interface Navigation {
	push(route: string, params?: object): void
	goBack(): void
	setOptions(options: { title: string }): void
	canGoBack?(): boolean
	popToTop?(): void
	getParent?(): Navigation | undefined
}

const useNavigation = () =>
	ReactNavigationNative.useNavigation() as unknown as Navigation

type Field = 'targetOut' | 'sourceOut' | 'targetIn'

interface LanguageParams {
	/** Setting to edit; without it `value` and `onSelect` are used. */
	field?: Field
	value?: string
	withAuto?: boolean
	onSelect?(code: string): void
}

function LanguagePage({ field, value, withAuto, onSelect }: LanguageParams) {
	const settings = useSettings()
	const navigation = useNavigation()
	const [query, setQuery] = useState('')
	const current = value ?? (field ? settings[field] : '')
	const languages = filterLanguages(
		withAuto ? SOURCE_LANGUAGES : LANGUAGES,
		query,
	)

	return (
		<Page>
			<SearchInput
				value={query}
				onChange={setQuery}
				placeholder="Search language"
			/>
			<Design.TableRadioGroup
				title="Languages"
				value={current}
				onChange={(code: string) => {
					if (onSelect) onSelect(code)
					else if (field) updateSettings({ [field]: code })
					navigation.goBack()
				}}
			>
				{languages.map(([code]) => (
					<Design.TableRadioRow
						key={code}
						value={code}
						label={languageLabel(code)}
						subLabel={code}
					/>
				))}
			</Design.TableRadioGroup>
		</Page>
	)
}

function QuickLanguagesPage() {
	const { favLangs } = useSettings()
	const [query, setQuery] = useState('')

	const toggle = (code: string) => {
		if (favLangs.includes(code))
			updateSettings({ favLangs: favLangs.filter(item => item !== code) })
		else if (favLangs.length < MAX_FAVORITES)
			updateSettings({ favLangs: [...favLangs, code] })
		else toast(`You can pick up to ${MAX_FAVORITES}`)
	}

	return (
		<Page>
			<SearchInput
				value={query}
				onChange={setQuery}
				placeholder="Search language"
			/>
			<Design.TableRowGroup
				title="Choose quick languages"
				description={`${favLangs.length} of ${MAX_FAVORITES} selected`}
			>
				{filterLanguages(LANGUAGES, query).map(([code]) => (
					<Design.TableCheckboxRow
						key={code}
						value={code}
						label={languageLabel(code)}
						subLabel={code}
						checked={favLangs.includes(code)}
						onPress={() => toggle(code)}
					/>
				))}
			</Design.TableRowGroup>
		</Page>
	)
}

function ColorPage() {
	const { translationColor } = useSettings()
	const navigation = useNavigation()
	// Presets whose colour family is missing from this Discord build are hidden.
	const presets = COLOR_PRESETS.filter(
		preset => preset.id === 'default' || resolveColor(preset.id),
	)

	return (
		<Page>
			<Design.TableRadioGroup
				title="Color presets"
				description="Your choice saves automatically."
				value={translationColor}
				onChange={(translationColor: string) => {
					updateSettings({ translationColor })
					refreshAll()
					navigation.goBack()
				}}
			>
				{presets.map(preset => (
					<Design.TableRadioRow
						key={preset.id}
						value={preset.id}
						label={preset.label}
						icon={
							// custom: colour swatch, no native component shows an arbitrary colour
							<View
								style={{
									width: 20,
									height: 20,
									borderRadius: 10,
									backgroundColor: resolveColor(preset.id),
								}}
							/>
						}
					/>
				))}
			</Design.TableRadioGroup>
		</Page>
	)
}

function WordRulesPage() {
	const { wordLanguageRules } = useSettings()
	const navigation = useNavigation()
	const [word, setWord] = useState('')
	const [language, setLanguage] = useState('')
	const [editing, setEditing] = useState<string | null>(null)
	const valid = !!word.trim() && isLanguage(language)

	const reset = () => {
		setWord('')
		setLanguage('')
		setEditing(null)
	}
	const save = () => {
		const key = word.trim().toLocaleLowerCase()
		const others = wordLanguageRules.filter(rule => {
			const existing = rule.word.toLocaleLowerCase()
			return existing !== key && existing !== editing
		})
		if (others.length >= MAX_RULES)
			return toast(`You can save up to ${MAX_RULES} word language rules`)
		updateSettings({
			wordLanguageRules: [...others, { word: word.trim(), language }],
		})
		reset()
	}

	return (
		<Page>
			<Design.Stack spacing={8}>
				<Design.TextInput
					label={editing ? 'Edit rule' : 'Add rule'}
					description="Choose a source language for a word or phrase. Only matching words are overridden, even inside a sentence. Explicit source languages and protected words take priority."
					placeholder="Word or phrase, e.g. Hello"
					maxLength={80}
					value={word}
					onChange={setWord}
				/>
				<Design.TableRowGroup>
					<Design.TableRow
						icon={<TableRowAssetIcon name="LanguageIcon" />}
						label="Source language"
						subLabel={language ? languageLabel(language) : 'Select a language'}
						arrow
						onPress={() =>
							navigation.push(ROUTE, {
								screen: 'language',
								title: 'Word language',
								props: { value: language, onSelect: setLanguage },
							})
						}
					/>
				</Design.TableRowGroup>
				<Design.Button
					text={editing ? 'Save rule' : 'Add rule'}
					disabled={!valid}
					onPress={save}
				/>
			</Design.Stack>
			<Design.TableRowGroup
				title="Saved rules"
				description="Case-insensitive, whole-word matching. Rules apply only in Auto-detect mode."
			>
				{wordLanguageRules.map(rule => (
					<Design.TableRow
						key={rule.word.toLocaleLowerCase()}
						icon={<TableRowAssetIcon name="LanguageIcon" />}
						label={rule.word}
						subLabel={languageLabel(rule.language)}
						onPress={() => {
							setWord(rule.word)
							setLanguage(rule.language)
							setEditing(rule.word.toLocaleLowerCase())
						}}
						trailing={
							<Design.IconButton
								icon={getAssetIdByName('TrashIcon')!}
								size="sm"
								variant="secondary"
								accessibilityLabel="Remove rule"
								onPress={() => {
									updateSettings({
										wordLanguageRules: wordLanguageRules.filter(
											item => item !== rule,
										),
									})
									if (editing === rule.word.toLocaleLowerCase()) reset()
								}}
							/>
						}
					/>
				))}
			</Design.TableRowGroup>
			{!wordLanguageRules.length && (
				<Design.Text variant="text-sm/normal" color="text-muted">
					No rules yet. For example, add Hello and choose its source language.
				</Design.Text>
			)}
		</Page>
	)
}

function ProtectedWordsPage() {
	const { protectedWords } = useSettings()
	const [word, setWord] = useState('')
	const add = () => {
		const value = word.trim()
		if (!value) return
		if (
			protectedWords.some(
				item => item.toLocaleLowerCase() === value.toLocaleLowerCase(),
			)
		)
			return toast('That word is already in the list')
		if (protectedWords.length >= MAX_PROTECTED)
			return toast(`You can keep up to ${MAX_PROTECTED} words unchanged`)
		updateSettings({ protectedWords: [...protectedWords, value] })
		setWord('')
	}

	return (
		<Page>
			<Design.Stack spacing={8}>
				<Design.TextInput
					label="Add word"
					description="Names and terms that are never translated. Matching is whole-word and case-insensitive."
					placeholder="Word or phrase"
					maxLength={80}
					value={word}
					onChange={setWord}
				/>
				<Design.Button text="Add" disabled={!word.trim()} onPress={add} />
			</Design.Stack>
			{protectedWords.length > 0 ? (
				<Design.TableRowGroup
					title={`Kept unchanged · ${protectedWords.length}`}
				>
					{protectedWords.map(item => (
						<Design.TableRow
							key={item}
							icon={<TableRowAssetIcon name="LockIcon" />}
							label={item}
							trailing={
								<Design.IconButton
									icon={getAssetIdByName('TrashIcon')!}
									size="sm"
									variant="secondary"
									accessibilityLabel="Remove word"
									onPress={() =>
										updateSettings({
											protectedWords: protectedWords.filter(
												value => value !== item,
											),
										})
									}
								/>
							}
						/>
					))}
				</Design.TableRowGroup>
			) : (
				<Design.Text variant="text-sm/normal" color="text-muted">
					No words yet. Add names or terms that should stay as they are.
				</Design.Text>
			)}
		</Page>
	)
}

/** Leaves every screen on top of the chat, then opens the chat and scrolls to the message. */
function jumpToMessage(entry: HistoryEntry, navigation: Navigation) {
	if (!entry.channelId || !entry.messageId)
		return toast('This translation is not linked to a Discord message')
	const jumper = findByProps<{ jumpToMessage(options: object): void }>(
		'jumpToMessage',
	)
	const router = findByProps<{
		transitionToChannel(id: string, options: object): void
	}>('transitionToChannel')
	if (!router || !jumper) return toast('Could not open this message')
	const { channelId, messageId } = entry
	let screen: Navigation | undefined = navigation
	for (let depth = 0; screen && depth < 8; depth++) {
		if (screen.canGoBack?.())
			screen.popToTop ? screen.popToTop() : screen.goBack()
		screen = screen.getParent?.()
	}
	router.transitionToChannel(channelId, {})
	setTimeout(
		() =>
			jumper.jumpToMessage({
				channelId,
				messageId,
				flash: true,
				jumpType: 'ANIMATED',
			}),
		650,
	)
}

function HistoryPage() {
	const { historyEntries } = useSettings()
	const navigation = useNavigation()
	const [query, setQuery] = useState('')
	const [retrying, setRetrying] = useState<string | null>(null)
	const needle = query.trim().toLowerCase()
	const shown = historyEntries.filter(
		entry =>
			!needle ||
			[
				entry.original,
				entry.translated,
				entry.channelName,
				languageLabel(entry.source),
				languageLabel(entry.target),
			]
				.join(' ')
				.toLowerCase()
				.includes(needle),
	)

	const tryOther = async (entry: HistoryEntry) => {
		if (retrying) return
		const provider = otherProvider(entry.provider)
		setRetrying(entry.id)
		try {
			const alternativeTranslated = await translateWith(
				provider,
				entry.original,
				entry.target,
				entry.source || 'auto',
			)
			updateSettings({
				historyEntries: getSettings().historyEntries.map(item =>
					item.id === entry.id
						? { ...item, alternativeTranslated, alternativeProvider: provider }
						: item,
				),
			})
		} catch (error) {
			toast(
				(error as Error)?.message ||
					`Could not retranslate with ${ProviderLabels[provider]}`,
			)
		} finally {
			setRetrying(null)
		}
	}

	return (
		<Page>
			<SearchInput
				value={query}
				onChange={setQuery}
				placeholder="Search translations, channels, or languages"
			/>
			<Design.Text variant="text-sm/normal" color="text-muted">
				{shown.length} shown · {historyEntries.length} saved locally
			</Design.Text>
			{!shown.length && (
				<Design.Text
					variant="text-md/normal"
					color="text-muted"
					style={{ textAlign: 'center' }}
				>
					{historyEntries.length
						? 'No history entries match this search.'
						: 'No translations saved yet.'}
				</Design.Text>
			)}
			{shown.map(entry => {
				const other = ProviderLabels[otherProvider(entry.provider)]
				return (
					<Design.TableRowGroup
						key={entry.id}
						title={`${languageLabel(entry.source)} → ${languageLabel(entry.target)}`}
					>
						<Design.TableRow
							icon={<TableRowAssetIcon name="LanguageIcon" />}
							label={entry.translated}
							subLabel={`${entry.original}\n${entry.channelName || channelLabel(entry.channelId)}${entry.messageId ? '' : ' · Draft'} · ${ProviderLabels[entry.provider]} · ${new Date(entry.at).toLocaleString()}`}
							subLabelLineClamp={5}
						/>
						{entry.alternativeTranslated && (
							<Design.TableRow
								icon={<TableRowAssetIcon name="RetryIcon" />}
								label={entry.alternativeTranslated}
								subLabel={`Alternative · ${ProviderLabels[entry.alternativeProvider ?? entry.provider]}`}
							/>
						)}
						<Design.TableRow
							icon={<TableRowAssetIcon name="CopyIcon" />}
							label="Copy translation"
							onPress={() => copyText(entry.translated)}
						/>
						<Design.TableRow
							icon={<TableRowAssetIcon name="RetryIcon" />}
							label={retrying === entry.id ? 'Translating…' : `Try ${other}`}
							disabled={!!retrying}
							onPress={() => tryOther(entry)}
						/>
						<Design.TableRow
							icon={<TableRowAssetIcon name="ArrowAngleRightUpIcon" />}
							label="Jump to message"
							disabled={!entry.channelId || !entry.messageId}
							onPress={() => jumpToMessage(entry, navigation)}
						/>
						<Design.TableRow
							variant="danger"
							icon={<TableRowAssetIcon variant="danger" name="TrashIcon" />}
							label="Delete"
							onPress={() => deleteHistoryEntry(entry)}
						/>
					</Design.TableRowGroup>
				)
			})}
		</Page>
	)
}

function AutoChannelsPage() {
	const { autoChannelIds } = useSettings()
	const [query, setQuery] = useState('')
	const needle = query.trim().toLowerCase()

	const toggle = (id: string) =>
		updateSettings({
			autoChannelIds: autoChannelIds.includes(id)
				? autoChannelIds.filter(item => item !== id)
				: [...autoChannelIds, id],
		})
	const row = (id: string, icon: string, label: string, subLabel?: string) => (
		<Design.TableCheckboxRow
			key={id}
			value={id}
			icon={<TableRowAssetIcon name={icon} />}
			label={label}
			subLabel={subLabel}
			checked={autoChannelIds.includes(id)}
			onPress={() => toggle(id)}
		/>
	)

	const dms = privateChannelIds()
		.map(id => getChannel(String(id)))
		.filter(channel => channel && isDM(channel))
		.map(channel => ({ id: String(channel!.id), label: dmName(channel!) }))
		.filter(dm => !needle || dm.label.toLowerCase().includes(needle))
	const servers = guilds()
		.map(guild => ({
			guild,
			channels: guildChannels(guild.id).filter(
				channel =>
					!needle ||
					String(channel.name).toLowerCase().includes(needle) ||
					String(guild.name).toLowerCase().includes(needle),
			),
		}))
		.filter(server => server.channels.length)

	return (
		<Page>
			<Design.Text variant="text-sm/normal" color="text-muted">
				Select only the channels and DMs where new incoming messages should be
				translated. {autoChannelIds.length} selected.
			</Design.Text>
			<SearchInput
				value={query}
				onChange={setQuery}
				placeholder="Search channels, servers, or DMs"
			/>
			{dms.length > 0 && (
				<Design.TableRowGroup title="Direct messages">
					{dms.map(dm => row(dm.id, 'ChatIcon', dm.label))}
				</Design.TableRowGroup>
			)}
			{servers.map(({ guild, channels }) => (
				<Design.TableRowGroup key={guild.id} title={guild.name || 'Server'}>
					{channels.map(channel =>
						row(
							String(channel.id),
							'HashmarkIcon',
							`# ${channel.name}`,
							channel.topic || undefined,
						),
					)}
				</Design.TableRowGroup>
			))}
			{!dms.length && !servers.length && (
				<Design.Text
					variant="text-md/normal"
					color="text-muted"
					style={{ textAlign: 'center' }}
				>
					No channels or DMs found. Open them once so the channel list can load.
				</Design.Text>
			)}
		</Page>
	)
}

const SCREENS = {
	language: LanguagePage,
	quick: QuickLanguagesPage,
	color: ColorPage,
	rules: WordRulesPage,
	words: ProtectedWordsPage,
	history: HistoryPage,
	channels: AutoChannelsPage,
}
type Screen = keyof typeof SCREENS

interface ScreenProps {
	navigation: Navigation
	route: { params: { screen: Screen; title: string; props?: object } }
}

function QuickTranslateScreen({ navigation, route }: ScreenProps) {
	const { screen, title, props } = route.params
	useLayoutEffect(() => navigation.setOptions({ title }), [navigation, title])
	return (
		<ScrollView keyboardShouldPersistTaps="handled">
			{createElement(SCREENS[screen] as ComponentType<object>, props)}
		</ScrollView>
	)
}

/** Opens one of the sub pages from the settings page. */
export function useGo() {
	const navigation = useNavigation()
	return (screen: Screen, title: string, props?: object) =>
		navigation.push(ROUTE, { screen, title, props })
}

/** Registers the hidden route the settings sub pages are shown in. */
export function registerPages({ cleanup }: Ctx) {
	cleanup(
		onSettingsModulesLoaded(() => {
			cleanup(
				registerSettingsItem(ROUTE, {
					parent: null,
					type: 'route',
					useTitle: () => 'Quick Translate',
					screen: { route: ROUTE, getComponent: () => QuickTranslateScreen },
				}),
			)
			refreshSettings()
		}),
	)
}
