import { getModules } from '@valenced/modules/finders'
import { createFilterGenerator } from '@valenced/modules/finders/filters'
import type { Filter } from '@valenced/modules/finders/filters'

/** What every installer receives from the plugin entry. */
export interface Ctx {
	cleanup(...fns: (() => unknown)[]): void
	report(error: unknown): void
}

type Render = Record<string, (...args: never[]) => unknown>

/** Matches a component by displayName, whether it is plain, memo or forwardRef. */
const withDisplayName = createFilterGenerator<[string]>(
	([name], _id, value) =>
		value?.type?.displayName === name ||
		value?.type?.render?.displayName === name ||
		value?.displayName === name ||
		value?.render?.displayName === name,
	([name]) => `dariuss.quick-translate.component(${name})`,
)

/** Where a component's render function lives, which depends on how it was wrapped. */
function renderSlot(value: {
	type?: unknown
	render?: unknown
}): [Render, string] | undefined {
	const type = value.type as { render?: unknown } | undefined
	if (typeof type === 'function') return [value as unknown as Render, 'type']
	if (typeof type?.render === 'function') return [type as Render, 'render']
	if (typeof value.render === 'function')
		return [value as unknown as Render, 'render']
}

/** Calls `callback` for every module a filter matches, reporting instead of throwing. */
export function watch<T>(
	{ cleanup, report }: Ctx,
	filter: Filter,
	callback: (exports: T) => void,
) {
	cleanup(
		getModules(filter, exports => {
			try {
				callback(exports as T)
			} catch (error) {
				report(error)
			}
		}),
	)
}

/** Calls `callback` with the object and key holding the render function of a named component. */
export function watchComponent(
	ctx: Ctx,
	name: string,
	callback: (target: Render, key: string) => void,
) {
	watch<{ type?: unknown; render?: unknown }>(
		ctx,
		withDisplayName(name),
		component => {
			const slot = renderSlot(component)
			if (slot) callback(...slot)
		},
	)
}
