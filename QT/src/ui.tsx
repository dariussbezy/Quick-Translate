import { useState } from "react";
import {
  View,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
} from "react-native";
import { Design } from "@valenced/discord/design";
import { ActionSheetActionCreators } from "@valenced/discord/actions";
import { Clipboard } from "@valenced/externals/react-native-clipboard";
import type { Runtime } from "./runtime";
import { languages, label } from "./model";
import type { Settings, Message, Entry } from "./model";

const styles = StyleSheet.create({
  body: { padding: 18, gap: 16, paddingBottom: 40 },
  hero: { backgroundColor: "#24253D", borderRadius: 20, padding: 22, gap: 8 },
  card: {
    borderWidth: 1,
    borderColor: "#8EA1FF44",
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  input: {
    color: "#EAEBF5",
    backgroundColor: "#24253D",
    borderRadius: 12,
    padding: 12,
    minHeight: 45,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#5865F2",
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  },
});
export function Action({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { opacity: disabled ? 0.45 : 1 }]}
    >
      <Design.Text variant="text-md/semibold" color="always-white">
        {title}
      </Design.Text>
    </Pressable>
  );
}
function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Design.Text variant="heading-md/bold" color="text-default">
        {title}
      </Design.Text>
      {children}
    </View>
  );
}
export function LanguagePicker({
  value,
  onChange,
  auto = false,
  favorites = [],
}: {
  value: string;
  onChange: (v: string) => void;
  auto?: boolean;
  favorites?: string[];
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Action
        title={label(value) === "auto" ? "Auto-detect" : label(value)}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && (
        <>
          <TextInput
            accessibilityLabel="Search languages"
            placeholder="Search language…"
            placeholderTextColor="#A4A7B8"
            style={styles.input}
            value={search}
            onChangeText={setSearch}
          />
          <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }}>
            {(auto ? [["auto", "Auto-detect"], ...languages] : [...languages])
              .sort(
                (a, b) =>
                  Number(favorites.includes(b[0])) -
                  Number(favorites.includes(a[0])),
              )
              .filter((x) =>
                x.join(" ").toLowerCase().includes(search.toLowerCase()),
              )
              .map(([code, name]) => (
                <Pressable
                  key={code}
                  accessibilityRole="button"
                  onPress={() => {
                    onChange(code);
                    setExpanded(false);
                    setSearch("");
                  }}
                  style={{ padding: 12 }}
                >
                  <Design.Text
                    variant="text-md/medium"
                    color={value === code ? "text-brand" : "text-default"}
                  >
                    {favorites.includes(code) ? "★ " : ""}
                    {name}
                  </Design.Text>
                </Pressable>
              ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}
export interface DraftAccess {
  read(): string;
  write(text: string): void;
}
export function openTranslator(
  runtime: Runtime,
  draft: DraftAccess,
  message?: Message,
) {
  const key = "QuickTranslatePanel";
  const Panel = () => (
    <Design.ActionSheet>
      <Tool runtime={runtime} draft={draft} message={message} />
    </Design.ActionSheet>
  );
  ActionSheetActionCreators.openLazy(
    Promise.resolve({ default: Panel }),
    key,
    {},
  );
}
function Tool({
  runtime,
  draft,
  message,
}: {
  runtime: Runtime;
  draft: DraftAccess;
  message?: Message;
}) {
  const channel = runtime.channel();
  const initial = message?.content ?? draft.read();
  const [text, setText] = useState(initial),
    [output, setOutput] = useState<Entry>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [target, setTarget] = useState(
    message ? runtime.languages.targetIn : runtime.languages.targetOut,
  );
  const [provider, setProvider] = useState(runtime.settings.provider);
  const [source, setSource] = useState(
    message ? "auto" : runtime.languages.sourceOut,
  );
  const [undo, setUndo] = useState<string>();
  const [tab, setTab] = useState<"translate" | "history" | "batch">(
    "translate",
  );
  const valid = runtime.alive;
  const translate = async () => {
    setBusy(true);
    setError("");
    try {
      // Per-panel choices do not change defaults or other conversations.
      const result = await runtime.engine.translate(text, {
        provider,
        target,
        source,
        key: runtime.settings.deeplApiKey,
        words: runtime.settings.protectedWords,
      });
      if (!runtime.alive) return;
      const entry: Entry = {
        ...result,
        original: text,
        target,
        channelId: message?.channel_id ?? channel,
        messageId: message?.id,
        time: Date.now(),
      };
      setOutput(entry);
      if (runtime.settings.saveHistory)
        await runtime.storage.set({
          history: [entry, ...runtime.settings.history].slice(0, 100),
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Design.Text variant="heading-xl/bold" color="always-white">
          Quick Translate
        </Design.Text>
        <Design.Text variant="text-sm/normal" color="always-white">
          {message
            ? "Translate a message"
            : "Translate your draft before sending"}
        </Design.Text>
      </View>
      <View style={styles.row}>
        <Action title="Translate" onPress={() => setTab("translate")} />
        <Action title="History" onPress={() => setTab("history")} />
        <Action title="Select messages" onPress={() => setTab("batch")} />
      </View>
      {tab === "history" ? (
        <History runtime={runtime} />
      ) : tab === "batch" ? (
        <Batch runtime={runtime} />
      ) : (
        <>
          <Card title="Languages">
            <Design.Text variant="text-sm/normal" color="text-muted">
              From
            </Design.Text>
            <LanguagePicker value={source} onChange={setSource} auto />
            <Design.Text variant="text-sm/normal" color="text-muted">
              To
            </Design.Text>
            <LanguagePicker
              value={target}
              onChange={setTarget}
              favorites={runtime.settings.favLangs}
            />
            <Action
              title={`Service: ${provider === "google" ? "Google" : "DeepL"}`}
              onPress={() =>
                setProvider(provider === "google" ? "deepl" : "google")
              }
            />
          </Card>
          <Card title="Original">
            <TextInput
              multiline
              accessibilityLabel="Original text"
              value={text}
              onChangeText={(v) => {
                setText(v);
                setOutput(undefined);
              }}
              style={[styles.input, { minHeight: 100 }]}
              placeholderTextColor="#A4A7B8"
              placeholder="Text to translate…"
            />
            <Design.Text variant="text-xs/normal" color="text-muted">
              Text is sent to{" "}
              {provider === "google" ? "Google Translate" : "DeepL"} when you
              tap Translate.
            </Design.Text>
            <Action
              title={busy ? "Translating…" : "Translate"}
              disabled={busy || !valid || !text.trim()}
              onPress={() => void translate()}
            />
          </Card>
          {!!error && (
            <Design.Text
              variant="text-md/normal"
              color="text-feedback-critical"
            >
              {error}
            </Design.Text>
          )}
          {output && (
            <Card title={`${label(output.source)} → ${label(output.target)}`}>
              <Design.Text
                selectable
                variant="text-md/normal"
                color="text-default"
                style={{ color: runtime.settings.translationColor }}
              >
                {output.text}
              </Design.Text>
              <View style={styles.row}>
                <Action
                  title="Copy"
                  onPress={() => Clipboard.setString(output.text)}
                />
                {!message && (
                  <Action
                    title="Use in draft"
                    disabled={!valid}
                    onPress={() => {
                      try {
                        if (
                          runtime.channel() !== channel ||
                          (draft.read() !== initial && draft.read() !== text)
                        )
                          throw new Error(
                            "Draft or conversation changed. Reopen Translate to avoid overwriting it.",
                          );
                        setUndo(draft.read());
                        draft.write(output.text);
                        setError("");
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  />
                )}{" "}
                {message && (
                  <Action
                    title="Show in chat"
                    disabled={!valid || text !== message.content}
                    onPress={() => {
                      runtime.entries.set(
                        `${message.channel_id}:${message.id}`,
                        output,
                      );
                      while (runtime.entries.size > 300)
                        runtime.entries.delete(
                          runtime.entries.keys().next().value!,
                        );
                      if (runtime.settings.keepMessageTranslations)
                        void runtime.storage.set({
                          saved: [...runtime.entries.values()],
                        });
                      runtime.refresh(message.channel_id, message.id);
                    }}
                  />
                )}
              </View>
            </Card>
          )}
          {undo !== undefined && (
            <Action
              title="Restore original draft"
              onPress={() => {
                try {
                  if (
                    runtime.channel() !== channel ||
                    draft.read() !== output?.text
                  )
                    throw new Error("Draft changed; original was not restored");
                  draft.write(undo);
                  setUndo(undefined);
                } catch (e) {
                  setError(String(e));
                }
              }}
            />
          )}
          {message && (
            <Action
              title="Show original in chat"
              onPress={() => runtime.original(message)}
            />
          )}
          <Action
            title="Remember these languages for this chat"
            disabled={!valid}
            onPress={() => {
              void runtime.storage.set({
                chatLanguages: {
                  ...runtime.settings.chatLanguages,
                  [channel]: {
                    targetIn: message ? target : runtime.languages.targetIn,
                    targetOut: message ? runtime.languages.targetOut : target,
                    sourceOut: message ? runtime.languages.sourceOut : source,
                  },
                },
              });
            }}
          />
        </>
      )}
    </ScrollView>
  );
}
function History({ runtime }: { runtime: Runtime }) {
  const [items, setItems] = useState(runtime.settings.history);
  return (
    <View style={{ gap: 12 }}>
      {!items.length && (
        <Design.Text variant="text-md/normal" color="text-muted">
          No saved translations.
        </Design.Text>
      )}
      {items.map((e, i) => (
        <Card
          key={`${e.time}:${i}`}
          title={`${label(e.source)} → ${label(e.target)}`}
        >
          <Design.Text selectable variant="text-sm/normal" color="text-muted">
            {e.original}
          </Design.Text>
          <Design.Text selectable variant="text-md/normal" color="text-default">
            {e.text}
          </Design.Text>
          <View style={styles.row}>
            <Action title="Copy" onPress={() => Clipboard.setString(e.text)} />
            <Action
              title="Delete"
              onPress={() => {
                const next = items.filter((_, index) => index !== i);
                setItems(next);
                void runtime.storage.set({ history: next });
              }}
            />
          </View>
        </Card>
      ))}
    </View>
  );
}
export function Preferences({
  runtime,
  settings,
}: {
  runtime: Runtime;
  settings: Settings;
}) {
  const set = (value: Partial<Settings>) => void runtime.storage.set(value);
  const toggle = (key: keyof Settings, title: string, subLabel?: string) => (
    <Design.TableSwitchRow
      label={title}
      subLabel={subLabel}
      value={Boolean(settings[key])}
      onValueChange={(value: boolean) => set({ [key]: value })}
    />
  );
  return (
    <ScrollView
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Design.Text variant="heading-xl/bold" color="always-white">
          Quick Translate
        </Design.Text>
        <Design.Text variant="text-sm/normal" color="always-white">
          Valenced · 2.0.0 beta 3 · Built from scratch
        </Design.Text>
      </View>
      <Action title="Open translator" onPress={() => runtime.open()} />
      <Card title="Translation service">
        <Action
          title={
            settings.provider === "google"
              ? "✓ Google Translate"
              : "Google Translate"
          }
          onPress={() => set({ provider: "google" })}
        />
        <Action
          title={settings.provider === "deepl" ? "✓ DeepL" : "DeepL"}
          onPress={() => set({ provider: "deepl" })}
        />
        {settings.provider === "deepl" && (
          <TextInput
            accessibilityLabel="DeepL API key"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            value={settings.deeplApiKey}
            onChangeText={(deeplApiKey) => set({ deeplApiKey })}
            placeholder="DeepL API key"
            placeholderTextColor="#A4A7B8"
          />
        )}
        <Design.Text variant="text-xs/normal" color="text-muted">
          Google uses an unofficial endpoint and can rate-limit requests. DeepL
          uses your API key, stored locally. No automatic provider fallback.
        </Design.Text>
      </Card>
      <Card title="Languages">
        <Design.Text variant="text-sm/normal" color="text-muted">
          Incoming messages
        </Design.Text>
        <LanguagePicker
          value={settings.targetIn}
          onChange={(targetIn) => set({ targetIn })}
        />
        <Design.Text variant="text-sm/normal" color="text-muted">
          Your messages
        </Design.Text>
        <LanguagePicker
          value={settings.targetOut}
          onChange={(targetOut) => set({ targetOut })}
        />
        <LanguagePicker
          value={settings.sourceOut}
          auto
          onChange={(sourceOut) => set({ sourceOut })}
        />
        {toggle(
          "rememberLanguagesPerChat",
          "Remember languages per conversation",
        )}
      </Card>
      <Card title="Appearance">
        <Design.TableRowGroup>
          {toggle("immersive", "Show translation below original")}
          {toggle("showSourceLanguage", "Show source language")}
          {toggle("showButton", "Show composer button")}
        </Design.TableRowGroup>
        <TextInput
          accessibilityLabel="Translation color"
          style={styles.input}
          defaultValue={settings.translationColor}
          autoCapitalize="none"
          onEndEditing={(e) => {
            if (/^#[\da-f]{6}$/i.test(e.nativeEvent.text))
              set({ translationColor: e.nativeEvent.text });
          }}
        />
      </Card>
      <Card title="Automatic translation">
        <Design.TableRowGroup>
          {toggle(
            "autoOutgoing",
            "Translate outgoing messages",
            "Disabled by default. Errors cancel sending; originals are never sent as a fallback.",
          )}
        </Design.TableRowGroup>
        <Action
          title={
            settings.autoChannelIds.includes(runtime.channel())
              ? "Disable for current conversation"
              : "Enable for current conversation"
          }
          onPress={() => {
            const id = runtime.channel();
            if (id)
              set({
                autoChannelIds: settings.autoChannelIds.includes(id)
                  ? settings.autoChannelIds.filter((x) => x !== id)
                  : [...settings.autoChannelIds, id],
              });
          }}
        />
        <Design.Text variant="text-xs/normal" color="text-muted">
          Enabled in {settings.autoChannelIds.length} conversations. Only new
          messages in the visible conversation are translated automatically.
        </Design.Text>
        <Action
          title="Disable all incoming auto-translation"
          onPress={() => set({ autoChannelIds: [] })}
        />
      </Card>
      <Card title="Quick languages">
        <View style={styles.row}>
          {languages.map(([code, name]) => (
            <Pressable
              key={code}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: settings.favLangs.includes(code) }}
              onPress={() => {
                const selected = settings.favLangs.includes(code);
                if (selected || settings.favLangs.length < 6)
                  set({
                    favLangs: selected
                      ? settings.favLangs.filter((x) => x !== code)
                      : [...settings.favLangs, code],
                  });
              }}
              style={{ padding: 8 }}
            >
              <Design.Text
                variant="text-sm/normal"
                color={
                  settings.favLangs.includes(code) ? "text-brand" : "text-muted"
                }
              >
                {settings.favLangs.includes(code) ? "★ " : ""}
                {name}
              </Design.Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <Card title="Keep words unchanged">
        <TextInput
          accessibilityLabel="Protected words"
          multiline
          style={styles.input}
          defaultValue={settings.protectedWords.join(", ")}
          placeholder="Names, terms…"
          placeholderTextColor="#A4A7B8"
          onEndEditing={(e) =>
            set({
              protectedWords: [
                ...new Set(
                  e.nativeEvent.text
                    .split(/[,\n]/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                ),
              ].slice(0, 100),
            })
          }
        />
        <Design.Text variant="text-xs/normal" color="text-muted">
          Code, mentions, Discord emoji and links are protected automatically.
        </Design.Text>
      </Card>
      <Card title="Local data">
        <Design.TableRowGroup>
          {toggle("saveHistory", "Save translation history")}
          {toggle(
            "keepMessageTranslations",
            "Keep chat translations after restart",
          )}
        </Design.TableRowGroup>
        <Action
          title="Clear history and translations"
          onPress={() => runtime.clear()}
        />
        <History runtime={runtime} />
      </Card>
    </ScrollView>
  );
}

function Batch({ runtime }: { runtime: Runtime }) {
  const [messages] = useState(() => runtime.loadedMessages());
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const translate = async () => {
    setBusy(true);
    let done = 0;
    try {
      for (const message of messages.filter((m) => selected.includes(m.id))) {
        if (!runtime.alive) break;
        await runtime.translate(message.content, true, message);
        done++;
        setStatus(`${done} translated`);
      }
    } catch (e) {
      setStatus(
        `${done} translated. ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Translate selected messages">
      <Design.Text variant="text-sm/normal" color="text-muted">
        Up to 25 messages already loaded in the current conversation. Uses your
        incoming language; does not fetch chat history.
      </Design.Text>
      {messages.map((m) => (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected.includes(m.id) }}
          disabled={busy}
          key={m.id}
          onPress={() =>
            setSelected(
              selected.includes(m.id)
                ? selected.filter((id) => id !== m.id)
                : [...selected, m.id],
            )
          }
          style={{ paddingVertical: 10 }}
        >
          <Design.Text
            numberOfLines={3}
            variant="text-sm/normal"
            color={selected.includes(m.id) ? "text-brand" : "text-default"}
          >
            {selected.includes(m.id) ? "✓ " : "○ "}
            {m.content}
          </Design.Text>
        </Pressable>
      ))}
      {!messages.length && (
        <Design.Text variant="text-sm/normal" color="text-muted">
          No loaded text messages available.
        </Design.Text>
      )}
      <Action
        title={busy ? "Translating…" : `Translate ${selected.length} messages`}
        disabled={busy || !selected.length}
        onPress={() => void translate()}
      />
      {!!status && (
        <Design.Text variant="text-sm/normal" color="text-muted">
          {status}
        </Design.Text>
      )}
    </Card>
  );
}
