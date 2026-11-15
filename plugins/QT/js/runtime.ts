// Plugin lifecycle plus everything that has to be cancelled when it stops or data is cleared.

const CANCELLED = 'Translation cancelled'

const REQUEST_GAP = 1200
const MAX_PENDING_AUTO = 4
const REQUEST_TIMEOUT = 12000

let running = false
let generation = 0
let pending = 0
let lastRequestAt = 0
let tail: Promise<unknown> = Promise.resolve()
const controllers = new Set<AbortController>()
const sleepers = new Set<() => void>()

export const isRunning = () => running
export const currentGeneration = () => generation

/** Marks the plugin as running; the returned function stops it and cancels all work. */
export function startRuntime() {
	running = true
	return () => {
		running = false
		cancelAll()
	}
}

/** Aborts in-flight requests and invalidates every translation started before this call. */
export function cancelAll() {
	generation++
	pending = 0
	lastRequestAt = 0
	tail = Promise.resolve()
	for (const controller of controllers) controller.abort()
	controllers.clear()
	for (const wake of sleepers) wake()
	sleepers.clear()
}

export function assertCurrent(since: number) {
	if (!running || since !== generation) throw new Error(CANCELLED)
}

function sleep(ms: number) {
	return new Promise<void>((resolve, reject) => {
		const wake = () => {
			clearTimeout(timer)
			sleepers.delete(wake)
			reject(new Error(CANCELLED))
		}
		const timer = setTimeout(() => {
			sleepers.delete(wake)
			resolve()
		}, ms)
		sleepers.add(wake)
	})
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}) {
	if (!running) throw new Error(CANCELLED)
	const controller = new AbortController()
	const upstream = init.signal
	const abort = () => controller.abort()
	if (upstream?.aborted) throw new Error(CANCELLED)
	upstream?.addEventListener('abort', abort, { once: true })
	controllers.add(controller)
	let timedOut = false
	const timer = setTimeout(() => {
		timedOut = true
		controller.abort()
	}, REQUEST_TIMEOUT)
	try {
		return await fetch(url, { ...init, signal: controller.signal })
	} catch (error) {
		if (!controller.signal.aborted) throw error
		throw new Error(timedOut ? 'Timed out' : CANCELLED)
	} finally {
		clearTimeout(timer)
		controllers.delete(controller)
		upstream?.removeEventListener('abort', abort)
	}
}

/** Runs requests one at a time, spaced out so providers are not flooded. */
export function enqueue<T>(work: () => Promise<T>, automatic = false) {
	if (automatic && pending >= MAX_PENDING_AUTO)
		return Promise.reject(
			new Error(
				'Automatic translation skipped because the request queue is busy',
			),
		)
	pending++
	const since = generation
	const done = () => {
		if (since === generation) pending = Math.max(0, pending - 1)
	}
	const task = tail.then(async () => {
		assertCurrent(since)
		const wait = REQUEST_GAP - (Date.now() - lastRequestAt)
		if (wait > 0) await sleep(wait)
		assertCurrent(since)
		lastRequestAt = Date.now()
		return work()
	})
	tail = task.then(done, done)
	return task
}
