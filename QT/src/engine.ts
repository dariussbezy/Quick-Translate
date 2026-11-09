export interface Options {
  provider: "google" | "deepl";
  target: string;
  source: string;
  key: string;
  words: string[];
}
export interface Result {
  text: string;
  source: string;
}
type Transport = (
  text: string,
  options: Options,
  signal: AbortSignal,
) => Promise<Result>;
const syntax =
  /```[\s\S]*?```|`[^`\n]+`|<a?:\w+:\d+>|<[@#][!&]?\d+>|<t:-?\d+(?::[A-Za-z])?>|https?:\/\/[^\s<>]+/gu;
export function protect(input: string, words: string[]) {
  const tokens: string[] = [];
  // Pick a marker absent from user text, including deliberately typed placeholders.
  let prefix = "QTKEEP";
  while (input.includes(prefix)) prefix += "X";
  const store = (value: string) => {
    const marker = `${prefix}${tokens.length}END`;
    tokens.push(value);
    return marker;
  };
  let text = input.replace(syntax, store);
  const escaped = words
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length)
    text = text.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}_])(?:${escaped.join("|")})(?![\\p{L}\\p{N}_])`,
        "giu",
      ),
      store,
    );
  return {
    text,
    tokens: tokens.map((value, i) => ({ marker: `${prefix}${i}END`, value })),
  };
}
export function restore(
  text: string,
  tokens: { marker: string; value: string }[],
) {
  for (const { marker, value } of tokens) {
    if (text.split(marker).length !== 2)
      throw new Error("Translation changed protected content; original kept.");
    text = text.replace(marker, () => value);
  }
  return text;
}
export class Engine {
  private cache = new Map<string, Result>();
  private pending = new Map<string, Promise<Result>>();
  private tail: Promise<unknown> = Promise.resolve();
  private controllers = new Set<AbortController>();
  private stopped = false;
  private last = 0;
  private paused = new Map<string, number>();
  private transport: Transport;
  private gap: number;
  private limit: number;
  constructor(
    transport: Transport = providerRequest,
    config: { gap?: number; cacheLimit?: number } = {},
  ) {
    this.transport = transport;
    this.gap = config.gap ?? 1200;
    this.limit = config.cacheLimit ?? 200;
  }
  get cacheSize() {
    return this.cache.size;
  }
  clear() {
    for (const controller of this.controllers) controller.abort();
    this.pending.clear();
    this.cache.clear();
  }
  dispose() {
    this.stopped = true;
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
    this.cache.clear();
  }
  translate(text: string, options: Options): Promise<Result> {
    if (this.stopped) return Promise.reject(new Error("Plugin stopped"));
    if (!text.trim()) return Promise.reject(new Error("No text to translate"));
    if (text.length > 16000)
      return Promise.reject(
        new Error("Translate at most 16000 characters at once"),
      );
    const snapshot = { ...options, words: [...options.words] };
    const id = JSON.stringify([text, snapshot]);
    const cached = this.cache.get(id);
    if (cached) {
      this.cache.delete(id);
      this.cache.set(id, cached);
      return Promise.resolve(cached);
    }
    const active = this.pending.get(id);
    if (active) return active;
    if (this.pending.size >= 8)
      return Promise.reject(new Error("Translation queue is full"));
    const controller = new AbortController();
    this.controllers.add(controller);
    const run = async () => {
      if (this.stopped || controller.signal.aborted)
        throw new Error("Translation cancelled");
      const wait = Math.max(0, this.last + this.gap - Date.now());
      if (wait)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            controller.signal.removeEventListener("abort", abort);
            resolve();
          }, wait);
          const abort = () => {
            clearTimeout(timer);
            reject(new Error("Plugin stopped"));
          };
          controller.signal.addEventListener("abort", abort, { once: true });
        });
      if (this.stopped || controller.signal.aborted)
        throw new Error("Translation cancelled");
      if ((this.paused.get(snapshot.provider) ?? 0) > Date.now())
        throw new Error("Provider paused after rate limiting; retry later");
      this.last = Date.now();
      const p = protect(text, snapshot.words);
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const result = await this.transport(
          p.text,
          snapshot,
          controller.signal,
        );
        if (this.stopped || controller.signal.aborted)
          throw new Error("Translation cancelled or timed out");
        const restored = { ...result, text: restore(result.text, p.tokens) };
        this.cache.set(id, restored);
        while (this.cache.size > this.limit)
          this.cache.delete(this.cache.keys().next().value!);
        return restored;
      } catch (error) {
        if (typeof (error as { retryAfter?: number }).retryAfter === "number")
          this.paused.set(
            snapshot.provider,
            Date.now() + (error as { retryAfter: number }).retryAfter,
          );
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };
    const job = this.tail.then(run);
    this.tail = job.catch(() => {});
    this.pending.set(id, job);
    const clean = () => {
      if (this.pending.get(id) === job) this.pending.delete(id);
      this.controllers.delete(controller);
    };
    job.then(clean, clean);
    return job;
  }
}
export async function providerRequest(
  text: string,
  o: Options,
  signal: AbortSignal,
): Promise<Result> {
  let response: Response;
  const code = (s: string) => (s === "no" ? "NB" : s.toUpperCase());
  if (o.provider === "deepl") {
    if (!o.key.trim()) throw new Error("Add your DeepL API key first");
    const target: Record<string, string> = {
      en: "EN-US",
      pt: "PT-BR",
      "zh-CN": "ZH-HANS",
      "zh-TW": "ZH-HANT",
    };
    response = await fetch(
      o.key.trim().endsWith(":fx")
        ? "https://api-free.deepl.com/v2/translate"
        : "https://api.deepl.com/v2/translate",
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `DeepL-Auth-Key ${o.key.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: [text],
          target_lang: target[o.target] ?? code(o.target),
          ...(o.source !== "auto"
            ? { source_lang: o.source.startsWith("zh") ? "ZH" : code(o.source) }
            : {}),
        }),
      },
    );
  } else {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${encodeURIComponent(o.source)}&tl=${encodeURIComponent(o.target)}`;
    response = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: `q=${encodeURIComponent(text)}`,
    });
  }
  if (!response.ok) {
    const error = Object.assign(
      new Error(`${o.provider}: HTTP ${response.status}`),
      { retryAfter: undefined as number | undefined },
    );
    if (response.status === 429) {
      const raw = response.headers.get("Retry-After");
      const seconds = Number(raw);
      error.retryAfter = Math.max(
        60000,
        Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(raw ?? "") - Date.now() || 60000,
      );
    }
    throw error;
  }
  const data = await response.json();
  const result =
    o.provider === "deepl"
      ? {
          text: data?.translations?.[0]?.text,
          source: data?.translations?.[0]?.detected_source_language ?? o.source,
        }
      : {
          text: Array.isArray(data?.[0])
            ? data[0]
                .map((part: unknown[]) =>
                  typeof part?.[0] === "string" ? part[0] : "",
                )
                .join("")
            : "",
          source: data?.[2] ?? o.source,
        };
  if (typeof result.text !== "string" || !result.text.trim())
    throw new Error("Translation service returned no text");
  return { text: result.text, source: String(result.source).toLowerCase() };
}
