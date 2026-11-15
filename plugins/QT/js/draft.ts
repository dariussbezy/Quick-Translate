import { useSyncExternalStore } from 'react'

/** Languages a draft is translated with while the composer's Translate button is active. */
export interface DraftJob {
	tl: string
	sl: string
	/** Translate once with these languages, then go back to `resume`. */
	oneShot?: boolean
	resume?: DraftJob | null
}

let armed: DraftJob | null = null
const listeners = new Set<() => void>()

export const getArmed = () => armed

export function setArmed(job: DraftJob | null) {
	armed = job
	for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export const useArmed = () => useSyncExternalStore(subscribe, getArmed)

/**
 * Pressing the Translate slot translates the draft with the active languages.
 * A translated draft always returns the slot to Send, including one-time overrides;
 * a failed translation stays active so it can be retried.
 */
export async function pressTranslateSlot(
	run: (tl: string, sl: string) => Promise<boolean>,
) {
	const job = armed
	if (job && (await run(job.tl, job.sl))) setArmed(null)
}
