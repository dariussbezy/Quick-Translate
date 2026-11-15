import { useSyncExternalStore } from 'react'
import { DefaultSettings } from './shared'
import type { JsonStorage } from '@valenced/json-storage'
import type { Settings } from './shared'

let storage: JsonStorage<Settings> | undefined
let state: Settings = DefaultSettings
const listeners = new Set<() => void>()

/** Keeps only known keys, so settings dropped by newer versions do not linger on disk. */
function normalize(data: Partial<Settings>): Settings {
	const next = { ...DefaultSettings }
	for (const key of Object.keys(DefaultSettings) as (keyof Settings)[])
		if (data[key] !== undefined)
			(next as Record<string, unknown>)[key] = data[key]
	if (next.anchor !== 'actions' && next.anchor !== 'send')
		next.anchor = DefaultSettings.anchor
	return next
}

/** Loads the persisted settings; this module is the only writer afterwards. */
export async function initStore(jsonStorage: JsonStorage<Settings>) {
	storage = jsonStorage
	state = normalize(await jsonStorage.get())
	return () => {
		storage = undefined
	}
}

export const getSettings = () => state

export function updateSettings(patch: Partial<Settings>) {
	state = { ...state, ...patch }
	for (const listener of listeners) listener()
	// Replace instead of merge: shrinking lists and removing chat entries must stick.
	void storage?.set(state, true)
}

const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export const useSettings = () => useSyncExternalStore(subscribe, getSettings)
