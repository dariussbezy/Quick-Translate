import { SearchInput } from '@valenced/components'
import { Design } from '@valenced/discord/design'
import { BottomSheet } from '@valenced/externals/gorhom'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, useWindowDimensions, View } from 'react-native'
import {
	findByProps,
	isTextMessageType,
	messagesIn,
	toast,
	userName,
} from './env'
import { getTranslation, messageText } from './messages'
import {
	closeSheet,
	openSheet,
	openTranslateSheet,
	SheetFrame,
	useBottomPadding,
} from './sheets'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import type { Message } from './env'

const PAGE_SIZE = 30
const BULK_SHEET_KEY = 'dariuss.quick-translate.bulk'

type Page = 'idle' | 'loading' | 'error' | 'end'

const compare = (a: string, b: string) =>
	a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)

const isTranslatable = (message: Message | undefined) =>
	!!message?.id &&
	typeof message.content === 'string' &&
	!!message.content.trim() &&
	isTextMessageType(message.type)

/** Unique translatable messages, newest first. */
function merge(current: Message[], incoming: Message[]) {
	const byId = new Map<string, Message>()
	for (const message of [...current, ...incoming])
		if (isTranslatable(message)) byId.set(String(message.id), message)
	return [...byId.values()].sort((a, b) => compare(String(b.id), String(a.id)))
}

interface HttpClient {
	get(options: {
		url: string
		query: Record<string, unknown>
		oldFormErrors?: boolean
	}): Promise<{ body?: unknown }>
}

/** Reads one page of channel history from Discord, rather than depending on its small UI cache. */
async function readPage(channelId: string, before: string | null) {
	const http = findByProps<{ HTTP?: HttpClient }>('HTTP')?.HTTP
	let raw: Message[]
	if (typeof http?.get === 'function') {
		const endpoints = findByProps<{
			Endpoints?: { MESSAGES?(channelId: string): string }
		}>('Endpoints')?.Endpoints
		const response = await http.get({
			url:
				endpoints?.MESSAGES?.(channelId) ??
				`/channels/${encodeURIComponent(channelId)}/messages`,
			query: { limit: PAGE_SIZE, ...(before && { before }) },
			oldFormErrors: true,
		})
		if (!Array.isArray(response?.body))
			throw new Error('Discord returned an invalid message page')
		raw = response.body
	} else {
		const actions = findByProps<{
			fetchMessages?(options: object): Promise<unknown>
		}>('fetchMessages')
		if (typeof actions?.fetchMessages !== 'function')
			throw new Error('Discord history API is unavailable')
		const result = (await actions.fetchMessages({
			channelId,
			limit: PAGE_SIZE,
			...(before && { before }),
		})) as { body?: unknown; messages?: unknown } | undefined
		const body = result?.body ?? result?.messages ?? result
		raw = Array.isArray(body) ? body : messagesIn(channelId)
		if (before)
			raw = raw.filter(message => compare(String(message.id), before) < 0)
	}
	const messages = raw
		.filter(message => message?.id)
		.map(message => ({
			...message,
			channel_id: message.channel_id ?? channelId,
		}))
		.sort((a, b) => compare(String(b.id), String(a.id)))
		.slice(0, PAGE_SIZE)
	return {
		messages,
		hasMore: raw.length >= PAGE_SIZE,
		before: String(messages.at(-1)?.id ?? before ?? '') || null,
	}
}

/** Lets the user tick several messages of a channel, then translates them together. */
export const openBulkSheet = (seed: Message) =>
	openSheet(
		BulkSheet,
		{ seed, channelId: String(seed.channel_id ?? seed.channelId) },
		BULK_SHEET_KEY,
	)

function BulkSheet({ seed, channelId }: { seed: Message; channelId: string }) {
	const { height } = useWindowDimensions()
	const bottom = useBottomPadding()
	const seedId = String(seed.id)
	const [messages, setMessages] = useState<Message[]>([])
	const [selected, setSelected] = useState<string[]>([seedId])
	const [query, setQuery] = useState('')
	const [page, setPage] = useState<Page>('loading')
	const cursor = useRef<string | null>(null)
	const busy = useRef(false)
	const alive = useRef(true)

	const loadMore = async () => {
		if (busy.current) return
		busy.current = true
		setPage('loading')
		try {
			const next = await readPage(channelId, cursor.current)
			if (!alive.current) return
			setMessages(current => merge(current, next.messages))
			cursor.current = next.before
			setPage(next.hasMore ? 'idle' : 'end')
		} catch {
			if (!alive.current) return
			setMessages(current => merge(current, messagesIn(channelId)))
			setPage('error')
		} finally {
			busy.current = false
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: loads the first page once
	useEffect(() => {
		void loadMore()
		return () => {
			alive.current = false
		}
	}, [])

	const needle = query.trim().toLowerCase()
	const shown = [
		seed,
		...messages.filter(message => String(message.id) !== seedId),
	].filter(
		message =>
			!needle || String(message.content).toLowerCase().includes(needle),
	)
	const allSelected =
		shown.length > 0 &&
		shown.every(message => selected.includes(String(message.id)))
	const toggle = (id: string) =>
		setSelected(current =>
			current.includes(id)
				? current.filter(item => item !== id)
				: [...current, id],
		)

	const translateSelected = () => {
		const chosen = shown.filter(message =>
			selected.includes(String(message.id)),
		)
		if (!chosen.length) return toast('Select at least one message')
		closeSheet(BULK_SHEET_KEY)
		const messages = chosen.map(message => ({
			...message,
			content: messageText(message.content),
		}))
		setTimeout(() => openTranslateSheet({ kind: 'messages', messages }), 150)
	}

	const bodyHeight = Math.round(height * 0.78)
	return (
		<SheetFrame title="Bulk translate" bodyHeight={bodyHeight}>
			<Design.Stack spacing={8} style={{ flex: 1, paddingBottom: bottom }}>
				<Design.Text variant="text-sm/normal" color="text-muted">
					{selected.length} selected · {messages.length + 1} loaded · newest
					first
				</Design.Text>
				<SearchInput
					value={query}
					onChange={setQuery}
					placeholder="Search messages"
				/>
				<Design.Stack direction="horizontal" spacing={8}>
					<Design.Button
						text={allSelected ? 'Deselect all' : 'Select all'}
						size="sm"
						variant="secondary"
						grow
						onPress={() =>
							setSelected(current =>
								allSelected
									? current.filter(
											id => !shown.some(message => String(message.id) === id),
										)
									: [
											...new Set([
												...current,
												...shown.map(message => String(message.id)),
											]),
										],
							)
						}
					/>
					<Design.Button
						text="Clear selection"
						size="sm"
						variant="secondary"
						grow
						onPress={() => setSelected([])}
					/>
				</Design.Stack>
				<BottomSheet.BottomSheetScrollView
					style={{ flex: 1 }}
					keyboardShouldPersistTaps="handled"
					scrollEventThrottle={180}
					onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
						const { contentOffset, layoutMeasurement, contentSize } =
							event.nativeEvent
						if (
							page !== 'loading' &&
							page !== 'end' &&
							contentOffset.y + layoutMeasurement.height >=
								contentSize.height - 96
						)
							void loadMore()
					}}
				>
					<Design.TableRowGroup title="Messages">
						{shown.map(message => {
							const id = String(message.id)
							const text = String(message.content).replace(/\s+/g, ' ').trim()
							const translated = getTranslation(id)?.translated
							return (
								<Design.TableCheckboxRow
									key={id}
									value={id}
									checked={selected.includes(id)}
									label={
										(id === seedId ? 'Selected message · ' : '') +
										userName(message.author)
									}
									subLabel={translated ? `${text}\n→ ${translated}` : text}
									subLabelLineClamp={5}
									onPress={() => toggle(id)}
								/>
							)
						})}
					</Design.TableRowGroup>
					{/* custom: loading indicator and status line below the list */}
					<View style={{ padding: 16, alignItems: 'center' }}>
						{page === 'loading' ? <ActivityIndicator /> : null}
						<Design.Text variant="text-sm/normal" color="text-muted">
							{page === 'loading'
								? `Loading ${PAGE_SIZE} messages…`
								: page === 'error'
									? 'Could not load older messages. Scroll down to retry.'
									: page === 'end'
										? 'End of available messages'
										: `Scroll down to load ${PAGE_SIZE} older messages`}
						</Design.Text>
					</View>
				</BottomSheet.BottomSheetScrollView>
				<Design.Button
					text={`Continue to translation · ${selected.length}`}
					disabled={!selected.length}
					onPress={translateSelected}
				/>
			</Design.Stack>
		</SheetFrame>
	)
}
