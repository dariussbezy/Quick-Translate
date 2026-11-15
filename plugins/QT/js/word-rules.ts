export interface WordRule {
	word: string
	language: string
}

interface Match {
	start: number
	end: number
	text: string
	language: string
}

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Word boundaries only apply where the edge is a cased letter, digit or underscore,
 * so Cyrillic, symbols and CJK text still match inside a sentence.
 */
const isWordChar = (char: string | undefined) =>
	!!char && (/[0-9_]/.test(char) || char.toLowerCase() !== char.toUpperCase())

/** Finds case-insensitive, whole-word occurrences of `word` in `text`. */
export function findWord(text: string, word: string) {
	const found: { start: number; end: number; text: string }[] = []
	for (const match of text.matchAll(new RegExp(escapeRegExp(word), 'giu'))) {
		const start = match.index
		const end = start + match[0].length
		if (isWordChar(word[0]) && isWordChar(text[start - 1])) continue
		if (isWordChar(word.at(-1)) && isWordChar(text[end])) continue
		found.push({ start, end, text: match[0] })
	}
	return found
}

/** Resolves only the configured words; the remaining sentence still uses Auto-detect. */
export async function prepareWordRules(
	text: string,
	originalTokens: string[],
	rules: WordRule[],
	target: string,
	translateWord: (word: string, language: string) => Promise<string>,
) {
	const tokens = [...originalTokens]
	const protectedRanges = [...text.matchAll(/§\s*\d+\s*§/g)].map(
		match => [match.index, match.index + match[0].length] as const,
	)

	const matches: Match[] = []
	for (const { word, language } of rules) {
		for (const found of findWord(text, word.trim())) {
			if (protectedRanges.some(([a, b]) => found.start < b && found.end > a))
				continue
			matches.push({ ...found, language })
		}
	}

	// Longest match wins when rules overlap.
	matches.sort(
		(a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
	)
	const chosen: Match[] = []
	let last = -1
	for (const match of matches) {
		if (match.start < last) continue
		chosen.push(match)
		last = match.end
	}

	const resolved = new Map<string, string>()
	let out = ''
	let cursor = 0
	for (const match of chosen) {
		const key = JSON.stringify([match.text, match.language])
		let translated = resolved.get(key)
		if (translated === undefined) {
			translated =
				match.language.toLowerCase() === target.toLowerCase()
					? match.text
					: await translateWord(match.text, match.language)
			if (!translated.trim())
				throw new Error('Word language rule returned an empty translation')
			resolved.set(key, translated)
		}
		out += `${text.slice(cursor, match.start)}§${tokens.length}§`
		tokens.push(translated)
		cursor = match.end
	}
	out += text.slice(cursor)

	const source = chosen.every(match => match.language === chosen[0].language)
		? chosen[0]?.language
		: undefined
	return { out, tokens, applied: chosen.length > 0, source }
}
