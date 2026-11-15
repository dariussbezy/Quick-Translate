import { ToastActionCreators } from '@valenced/discord/actions'
import { Stores } from '@valenced/discord/flux'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { lookupModule } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'

export interface User {
	id: string
	username?: string
	globalName?: string
	global_name?: string
}

export interface Channel {
	id: string
	type: number
	name?: string
	topic?: string
	guild_id?: string
	recipients?: string[]
}

/** A node of Discord's parsed message AST. */
export interface MessageNode {
	type: string
	content?: string | MessageNode[]
	name?: string
	__tr?: boolean
	[key: string]: unknown
}

export interface Message {
	id: string
	channel_id?: string
	channelId?: string
	content: string | MessageNode[]
	author?: User
	type?: number
	[key: string]: unknown
}

interface MessageCollection {
	toArray?(): Message[]
	_array?: Message[]
}

const channelStore = () =>
	Stores.ChannelStore as unknown as Record<string, unknown> & {
		getChannel(id: string): Channel | undefined
	}
const messageStore = () =>
	Stores.MessageStore as unknown as {
		getMessage(channelId: string, id: string): Message | undefined
		getMessages(channelId: string): MessageCollection | undefined
	}
const userStore = () =>
	Stores.UserStore as unknown as {
		getUser(id: string): User | undefined
		getCurrentUser(): User | undefined
	}
const selectedChannelStore = () =>
	Stores.SelectedChannelStore as unknown as { getChannelId(): string | null }

let toastCount = 0
export const toast = (text: string) =>
	ToastActionCreators.open(`dariuss.quick-translate.${++toastCount}`, { text })

export function copyText(text: string) {
	Clipboard.setString(text)
	toast('Copied')
}

const modules = new Map<string, unknown>()

/** Finds a Discord module by its export names. Misses are not cached. */
export function findByProps<T extends Record<string, any>>(
	...names: [string, ...string[]]
) {
	const key = names.join('|')
	if (modules.has(key)) return modules.get(key) as T
	const [exports, id] = lookupModule(withProps<T>(...names))
	if (id === undefined) return undefined
	modules.set(key, exports)
	return exports as T
}

export const resetModuleCache = () => modules.clear()

export const isDM = (channel: Channel | undefined) =>
	channel?.type === 1 || channel?.type === 3

export const getChannel = (id: string | null | undefined) =>
	id ? channelStore().getChannel(id) : undefined

export const getMessage = (channelId: string, id: string) =>
	messageStore().getMessage(channelId, id)

export const getUser = (id: string) => userStore().getUser(id)

export const currentUserId = () => userStore().getCurrentUser()?.id

export const currentChannelId = () =>
	selectedChannelStore().getChannelId() ?? null

export const userName = (user: User | undefined) =>
	user?.globalName ?? user?.global_name ?? user?.username ?? 'Unknown'

export function messagesIn(channelId: string) {
	const collection = messageStore().getMessages(channelId)
	return collection?.toArray?.() ?? collection?._array ?? []
}

export const channelOf = (message: Message) =>
	String(message.channel_id ?? message.channelId ?? currentChannelId() ?? '')

export function dmName(channel: Channel) {
	const names = (channel.recipients ?? []).map(id => userName(getUser(id)))
	return channel.name || names.join(', ') || 'Direct message'
}

/** Human readable channel name for history entries and logs. */
export function channelLabel(channelId: string | null) {
	const channel = getChannel(channelId)
	if (!channel) return channelId ? 'Unavailable channel' : 'Draft (not sent)'
	if (isDM(channel)) return dmName(channel)
	return channel.name ? `# ${channel.name}` : 'Channel'
}

export interface Guild {
	id: string
	name?: string
}

export const guilds = () =>
	Object.values(
		(
			Stores.GuildStore as unknown as { getGuilds(): Record<string, Guild> }
		).getGuilds(),
	)

export const privateChannelIds = () =>
	(
		Stores.PrivateChannelSortStore as unknown as {
			getPrivateChannelIds(): string[]
		}
	).getPrivateChannelIds()

/** Channels of a guild, whichever shape Discord's store returns them in. */
export function guildChannels(guildId: string) {
	const store = channelStore()
	const found = new Map<string, Channel>()
	const visit = (value: unknown, depth = 0) => {
		if (!value || typeof value !== 'object' || depth > 5) return
		if (Array.isArray(value))
			return value.forEach(item => visit(item, depth + 1))
		const item = value as Partial<Channel>
		if (item.id != null && item.name != null) {
			const channel = store.getChannel(String(item.id)) ?? (item as Channel)
			if ([0, 5, 10, 11, 12, 15, 16].includes(channel.type))
				found.set(String(channel.id), channel)
		}
		for (const child of Object.values(value)) visit(child, depth + 1)
	}
	for (const method of [
		'getMutableGuildChannelsForGuild',
		'getGuildChannels',
		'getChannels',
		'getSortedChannels',
	]) {
		const read = store[method]
		if (typeof read === 'function') visit(read.call(store, guildId))
	}
	return [...found.values()]
}
