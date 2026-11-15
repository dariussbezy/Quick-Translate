import { cloneElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'

/**
 * Left to right is top to bottom: Quick Translate, Voice Messages To Text, Advanced Message Logger.
 * Each plugin keeps its own copy of this helper so they order themselves without depending on each other.
 */
const ORDER = ['qt-menu', 'vt-menu', 'aml-menu']

type Props = { children?: ReactNode; label?: unknown; message?: unknown }

const textOf = (node: ReactNode) => {
	if (!isValidElement<Props>(node)) return ''
	const { label, message } = node.props
	return typeof label === 'string'
		? label
		: typeof message === 'string'
			? message
			: ''
}
const isMarkUnread = (node: ReactNode) => /mark.*unread/i.test(textOf(node))
const flat = (children: ReactNode) =>
	[children].flat(Number.POSITIVE_INFINITY) as ReactNode[]

function holdsMarkUnread(node: ReactNode, depth = 0): boolean {
	if (depth > 12 || !isValidElement<Props>(node)) return false
	return (
		isMarkUnread(node) ||
		flat(node.props.children).some(child => holdsMarkUnread(child, depth + 1))
	)
}

/**
 * Places a group of rows right above the group that holds "Mark Unread" (so below Forward),
 * keeping the plugins' own groups in ORDER. Returns null when that spot cannot be found.
 */
export function placeGroup(
	children: ReactNode,
	group: ReactElement,
): ReactNode[] | null {
	const rank = ORDER.indexOf(String(group.key))
	const list = flat(children)
	const at = list.findIndex(child => holdsMarkUnread(child))
	if (at < 0) return null
	const child = list[at] as ReactElement<Props>
	if (!isMarkUnread(child) && !flat(child.props.children).some(isMarkUnread)) {
		const inner = placeGroup(child.props.children, group)
		if (!inner) return null
		const next = [...list]
		next[at] = cloneElement(child, { children: inner })
		return next
	}
	let index = at
	while (index > 0) {
		const before = list[index - 1]
		const other = isValidElement(before)
			? ORDER.indexOf(String(before.key))
			: -1
		if (other <= rank) break
		index--
	}
	return [...list.slice(0, index), group, ...list.slice(index)]
}
