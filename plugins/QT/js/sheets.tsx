import { SearchInput } from '@valenced/components'
import { ActionSheetActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { BottomSheet } from '@valenced/externals/gorhom'
import { ReactNativeSafeAreaContext } from '@valenced/externals/react-native-safe-area-context'
import { useState } from 'react'
import { useWindowDimensions, View } from 'react-native'
import {
	getChatLanguages,
	hasRestorableDraft,
	restoreOriginal,
	saveChatLanguages,
} from './composer'
import { getArmed, setArmed, useArmed } from './draft'
import { currentChannelId, toast } from './env'
import { translateMessages } from './messages'
import {
	filterLanguages,
	LANGUAGES,
	languageLabel,
	languageName,
	SOURCE_LANGUAGES,
} from './shared'
import { useSettings } from './store'
import type { ComponentType, ReactNode } from 'react'
import type { Message } from './env'

const SHEET_KEY = 'dariuss.quick-translate.sheet'

export function openSheet<P extends object>(
	Component: ComponentType<P>,
	props: P,
	key = SHEET_KEY,
) {
	ActionSheetActionCreators.openLazy(
		Promise.resolve({ default: Component }),
		key,
		props,
	)
}

export const closeSheet = (key = SHEET_KEY) =>
	ActionSheetActionCreators.hideActionSheet(key)

export function useBottomPadding() {
	const { bottom } = ReactNativeSafeAreaContext.useSafeAreaInsets()
	return Math.max(24, bottom + 8)
}

/** Bottom sheet with a title and a fixed-height body: the sheet needs numeric heights. */
export function SheetFrame({
	title,
	bodyHeight,
	children,
}: {
	title: string
	bodyHeight: number
	children: ReactNode
}) {
	const { height } = useWindowDimensions()
	const sheetHeight = Math.min(Math.round(height * 0.92), bodyHeight + 64)
	return (
		<Design.ActionSheet
			startExpanded={false}
			startHeight={sheetHeight}
			contentHeight={bodyHeight}
			scrollable
			maxHeight={sheetHeight}
			header={<Design.BottomSheetTitleHeader title={title} />}
		>
			{/* custom: the body needs an explicit height for the sheet's scroll view */}
			<View style={{ height: bodyHeight }}>{children}</View>
		</Design.ActionSheet>
	)
}

type Request = { kind: 'draft' } | { kind: 'messages'; messages: Message[] }
type Page = 'main' | 'source' | 'target'

/** Translate a draft once or set its languages, or translate chosen messages once. */
export const openTranslateSheet = (request: Request) =>
	openSheet(TranslateSheet, { request })

function TranslateSheet({ request }: { request: Request }) {
	const settings = useSettings()
	const armed = useArmed()
	const bottom = useBottomPadding()
	const { height } = useWindowDimensions()
	const draft = request.kind === 'draft'
	const [source, setSource] = useState(
		draft ? getChatLanguages().sourceOut : 'auto',
	)
	const [target, setTarget] = useState(
		draft ? getChatLanguages().targetOut : settings.targetIn,
	)
	const [page, setPage] = useState<Page>('main')
	const [query, setQuery] = useState('')
	const [measured, setMeasured] = useState(0)
	const [busy, setBusy] = useState(false)

	const goTo = (next: Page) => {
		setQuery('')
		setPage(next)
	}
	const finish = (message?: string) => {
		closeSheet()
		if (message) toast(message)
	}

	const activateOnce = () => {
		setArmed({
			tl: target,
			sl: source,
			oneShot: true,
			resume: armed?.oneShot ? armed.resume : armed,
		})
		finish(
			`Translate once is ready. Translate the draft to ${languageName(target)}; your usual language will return after.`,
		)
	}
	const setUsual = () => {
		saveChatLanguages(currentChannelId(), { targetOut: target })
		const current = getArmed()
		if (current?.oneShot)
			setArmed({ ...current, resume: { tl: target, sl: source } })
		else if (current) setArmed({ tl: target, sl: source })
		finish(`${languageName(target)} is now the usual language for this chat`)
	}
	const translateChosen = async () => {
		if (request.kind !== 'messages') return
		setBusy(true)
		const done = await translateMessages(request.messages, target, source)
		setBusy(false)
		if (done) closeSheet()
	}

	const count = request.kind === 'messages' ? request.messages.length : 0
	const hint = draft
		? 'Translate this draft once. Your chat’s default language stays unchanged.'
		: `Choose languages, then translate ${count > 1 ? `${count} selected messages` : 'this message'} once.`

	if (page !== 'main') {
		const picking = page === 'source' ? source : target
		const languages = filterLanguages(
			page === 'source' ? SOURCE_LANGUAGES : LANGUAGES,
			query,
		)
		const choose = (code: string) => {
			if (page === 'source') {
				setSource(code)
				if (draft) saveChatLanguages(currentChannelId(), { sourceOut: code })
			} else setTarget(code)
			goTo('main')
		}
		return (
			<SheetFrame
				title={draft ? 'Translate draft' : 'Translate messages'}
				bodyHeight={Math.round(height * 0.68)}
			>
				<BottomSheet.BottomSheetScrollView
					keyboardShouldPersistTaps="handled"
					contentContainerStyle={{ paddingBottom: bottom }}
				>
					<Design.Stack spacing={12}>
						<Design.Button
							text="Back"
							size="sm"
							variant="secondary"
							onPress={() => goTo('main')}
						/>
						<SearchInput
							value={query}
							onChange={setQuery}
							placeholder="Search language"
						/>
						<Design.TableRadioGroup
							title={page === 'source' ? 'Translate from' : 'Translate to'}
							value={picking}
							onChange={choose}
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
					</Design.Stack>
				</BottomSheet.BottomSheetScrollView>
			</SheetFrame>
		)
	}

	return (
		<SheetFrame
			title={
				draft
					? 'Translate draft'
					: count > 1
						? 'Translate messages'
						: 'Translate message'
			}
			bodyHeight={Math.min(Math.round(height * 0.81), measured || 390)}
		>
			<BottomSheet.BottomSheetScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{ paddingBottom: bottom }}
				onContentSizeChange={(_width: number, content: number) =>
					content > 0 && setMeasured(Math.ceil(content))
				}
			>
				<Design.Stack spacing={12}>
					<Design.Text variant="text-sm/normal" color="text-muted">
						{hint}
					</Design.Text>
					<Design.TableRowGroup title="Languages">
						<Design.TableRow
							label="Translate from"
							subLabel={languageLabel(source)}
							arrow
							onPress={() => goTo('source')}
						/>
						<Design.TableRow
							label="Translate to"
							subLabel={languageLabel(target)}
							arrow
							onPress={() => goTo('target')}
						/>
					</Design.TableRowGroup>
					{settings.favLangs.length > 0 && (
						<Design.Stack spacing={6}>
							<Design.Text variant="text-sm/medium" color="text-muted">
								Quick languages
							</Design.Text>
							<Design.Stack direction="horizontal" spacing={6}>
								{settings.favLangs.map(code => (
									<Design.Button
										key={code}
										text={code.toUpperCase()}
										size="sm"
										variant={code === target ? 'primary' : 'secondary'}
										accessibilityLabel={languageName(code)}
										accessibilityState={{ selected: code === target }}
										style={{ flex: 1, minWidth: 0 }}
										onPress={() => setTarget(code)}
									/>
								))}
							</Design.Stack>
						</Design.Stack>
					)}
					<Design.Stack spacing={6}>
						{draft ? (
							<>
								<Design.Button
									text={`Activate once · ${languageName(target)}`}
									size="sm"
									onPress={activateOnce}
								/>
								<Design.Button
									text={`Set ${languageName(target)} as usual`}
									size="sm"
									variant="secondary"
									onPress={setUsual}
								/>
								{hasRestorableDraft() && (
									<Design.Button
										text="Restore original text"
										size="sm"
										variant="secondary"
										onPress={() => {
											finish()
											restoreOriginal()
										}}
									/>
								)}
								{armed && (
									<Design.Button
										text="Turn off Translate"
										size="sm"
										variant="secondary"
										onPress={() => {
											setArmed(null)
											finish()
										}}
									/>
								)}
							</>
						) : (
							<Design.Button
								text={
									busy
										? 'Translating…'
										: `Translate once · ${languageName(target)}`
								}
								size="sm"
								disabled={busy}
								onPress={translateChosen}
							/>
						)}
					</Design.Stack>
				</Design.Stack>
			</BottomSheet.BottomSheetScrollView>
		</SheetFrame>
	)
}
