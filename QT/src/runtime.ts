import { Engine } from "./engine";
import type { Settings, Message, Entry } from "./model";
export interface Storage {
  cache: Settings | undefined;
  get(): Promise<Settings>;
  set(value: Partial<Settings>): Promise<unknown> | unknown;
}
export class Runtime {
  engine = new Engine();
  alive = true;
  entries = new Map<string, Entry>();
  open: () => void = () => {};
  loadedMessages: () => Message[] = () => [];
  storage: Storage;
  refresh: (channel: string, id: string) => void = () => {};
  channel: () => string = () => "";
  constructor(storage: Storage) {
    this.storage = storage;
  }
  get settings() {
    return this.storage.cache!;
  }
  get languages() {
    return this.settings.rememberLanguagesPerChat
      ? (this.settings.chatLanguages[this.channel()] ?? this.settings)
      : this.settings;
  }
  options(incoming: boolean, provider = this.settings.provider) {
    return {
      provider,
      target: incoming ? this.languages.targetIn : this.languages.targetOut,
      source: incoming ? "auto" : this.languages.sourceOut,
      key: this.settings.deeplApiKey,
      words: this.settings.protectedWords,
    };
  }
  async translate(
    original: string,
    incoming: boolean,
    message?: Message,
    provider = this.settings.provider,
  ) {
    const channelId = message?.channel_id ?? this.channel(),
      opts = this.options(incoming, provider);
    const result = await this.engine.translate(original, opts);
    if (!this.alive) throw new Error("Plugin stopped");
    const entry: Entry = {
      ...result,
      original,
      target: opts.target,
      channelId,
      messageId: message?.id,
      time: Date.now(),
    };
    if (this.settings.saveHistory)
      await this.storage.set({
        history: [
          entry,
          ...this.settings.history.filter(
            (e) =>
              !(
                e.original === original &&
                e.target === entry.target &&
                e.channelId === channelId
              ),
          ),
        ].slice(0, 100),
      });
    if (message) {
      this.entries.set(`${channelId}:${message.id}`, entry);
      while (this.entries.size > 300)
        this.entries.delete(this.entries.keys().next().value!);
      if (this.settings.keepMessageTranslations)
        await this.storage.set({ saved: [...this.entries.values()] });
      if (this.alive) this.refresh(channelId, message.id);
    }
    return entry;
  }
  original(message: Message) {
    this.entries.delete(`${message.channel_id}:${message.id}`);
    void this.storage.set({ saved: [...this.entries.values()] });
    this.refresh(message.channel_id, message.id);
  }
  restore() {
    if (!this.settings.keepMessageTranslations) return;
    for (const entry of this.settings.saved.slice(-300))
      if (entry.messageId)
        this.entries.set(`${entry.channelId}:${entry.messageId}`, entry);
  }
  clear() {
    const previous = [...this.entries.values()];
    this.entries.clear();
    this.engine.clear();
    void this.storage.set({ saved: [], history: [] });
    for (const e of previous)
      if (e.messageId) this.refresh(e.channelId, e.messageId);
  }
  dispose() {
    this.alive = false;
    this.engine.dispose();
    const previous = [...this.entries.values()];
    this.entries.clear();
    for (const e of previous)
      if (e.messageId) this.refresh(e.channelId, e.messageId);
  }
}
