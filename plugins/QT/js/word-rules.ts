export interface WordRule {
  word: string;
  language: string;
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordCharacter = (value: string | undefined) =>
  !!value && /[\p{L}\p{N}_]/u.test(value);

/** Resolve only configured words; the remaining sentence still uses Auto-detect. */
export async function prepareWordRules(
  text: string,
  originalTokens: string[],
  rules: WordRule[],
  target: string,
  translateWord: (word: string, language: string) => Promise<string>,
) {
  if (!rules.length)
    return {
      out: text,
      tokens: [...originalTokens],
      applied: false,
      source: undefined,
    };
  const protectedRanges = [...text.matchAll(/§\s*\d+\s*§/g)].map((match) => [
    match.index!,
    match.index! + match[0].length,
  ]);
  const matches: {
    start: number;
    end: number;
    text: string;
    language: string;
  }[] = [];
  for (const rule of rules.slice(0, 100)) {
    if (!rule.word?.trim() || !rule.language || rule.language === "auto")
      continue;
    const word = rule.word.trim();
    const pattern = new RegExp(escape(word), "giu");
    for (const match of text.matchAll(pattern)) {
      const start = match.index!,
        end = start + match[0].length;
      if (protectedRanges.some(([a, b]) => start < b && end > a)) continue;
      if (wordCharacter(word[0]) && wordCharacter(text[start - 1])) continue;
      if (wordCharacter(word.at(-1)) && wordCharacter(text[end])) continue;
      matches.push({ start, end, text: match[0], language: rule.language });
    }
  }
  matches.sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  const chosen: typeof matches = [];
  let last = -1;
  for (const match of matches)
    if (match.start >= last) {
      chosen.push(match);
      last = match.end;
    }
  const tokens = [...originalTokens],
    resolved = new Map<string, string>();
  let out = "",
    cursor = 0;
  for (const match of chosen) {
    const key = JSON.stringify([match.text, match.language]);
    let translated = resolved.get(key);
    if (translated === undefined) {
      translated =
        match.language.toLowerCase() === target.toLowerCase()
          ? match.text
          : await translateWord(match.text, match.language);
      if (!translated.trim())
        throw new Error("Word language rule returned an empty translation");
      resolved.set(key, translated);
    }
    out += text.slice(cursor, match.start) + `§${tokens.length}§`;
    tokens.push(translated);
    cursor = match.end;
  }
  out += text.slice(cursor);
  const source =
    chosen.length &&
    chosen.every((match) => match.language === chosen[0].language)
      ? chosen[0].language
      : undefined;
  return { out, tokens, applied: chosen.length > 0, source };
}
