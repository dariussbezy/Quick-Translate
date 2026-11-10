import { BottomSheet } from "@valenced/externals/gorhom";
import { TranslationSheet } from "./translation-sheet";
import { Design } from "@valenced/discord/design";
import {
  NativeSection as CustomSection,
  NativeRow as CustomRow,
  NativeSwitch as CustomSwitch,
  NativeAction as CustomAction,
  NativeIconControl,
  rowIcon,
  settingsContent,
  useSheetBottomPadding,
  NativeGuide as KitGuide,
  NativeInput as CustomInput,
} from "../../../shared/native-ui";
// Valenced integration for Quick Translate.
// The adapter contains Valenced-specific discovery, patching, persistence and navigation.
import * as React from "react";
import * as RN from "react-native";
import {
  findAssetId,
  after,
  before,
  instead,
  createPluginStore,
  showToast,
  findByProps,
  findByStoreName,
  clipboard,
  FluxDispatcher,
  NavigationNative,
  store,
  fetchWithTimeout,
  observeName,
  observeProps,
  observeComponent,
  installMessageMenu,
  isRunning,
  cancelRequests,
  reportIntegrationError,
  waitForTurn,
  readHistoryPage,
} from "./valenced";
import { prepareWordRules } from "./word-rules";
const ChannelStore = store("ChannelStore"),
  MessageStore = store("MessageStore"),
  PrivateChannelSortStore = store("PrivateChannelSortStore"),
  SelectedChannelStore = store("SelectedChannelStore"),
  UserStore = store("UserStore");
/* ------------------------------------------------------------------ */
/* constants + settings store                                          */
/* ------------------------------------------------------------------ */
const BUILD = "1.0.0-beta";
const ACCENT = "#8EA1FF";
const MAX_TRANSLATIONS = 300;
const MAX_CACHE = 200;
const MAX_HISTORY = 100;
const MAX_FAVS = 5;
const REQUEST_GAP = 1200;
const MAX_PENDING_AUTO_REQUESTS = 4;
const DEFAULT_429_COOLDOWN = 60000;
const PROTECT =
  /```[\s\S]*?```|`[^`\n]+`|<a?:\w+:\d+>|<[@#][!&]?\d+>|<t:-?\d+(?::[A-Za-z])?>|https?:\/\/[^\s<>]+/g;
const INLINE = new Set([
  "text",
  "strong",
  "em",
  "u",
  "s",
  "inlineCode",
  "customEmoji",
]);
const HEX = /^#[0-9A-Fa-f]{6}$/;
const LANGS = [
  ["en", "English"],
  ["ro", "Romanian"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["uk", "Ukrainian"],
  ["pl", "Polish"],
  ["nl", "Dutch"],
  ["tr", "Turkish"],
  ["ar", "Arabic"],
  ["he", "Hebrew"],
  ["hi", "Hindi"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh-CN", "Chinese (Simplified)"],
  ["zh-TW", "Chinese (Traditional)"],
  ["id", "Indonesian"],
  ["th", "Thai"],
  ["vi", "Vietnamese"],
  ["sv", "Swedish"],
  ["da", "Danish"],
  ["no", "Norwegian"],
  ["fi", "Finnish"],
  ["cs", "Czech"],
  ["sk", "Slovak"],
  ["hu", "Hungarian"],
  ["el", "Greek"],
  ["bg", "Bulgarian"],
  ["sr", "Serbian"],
  ["hr", "Croatian"],
  ["sl", "Slovenian"],
  ["lt", "Lithuanian"],
  ["lv", "Latvian"],
  ["et", "Estonian"],
  ["fa", "Persian"],
  ["bn", "Bengali"],
  ["ur", "Urdu"],
  ["ms", "Malay"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["sw", "Swahili"],
  ["af", "Afrikaans"],
  ["ca", "Catalan"],
  ["tl", "Filipino"],
  ["is", "Icelandic"],
  ["ga", "Irish"],
  ["cy", "Welsh"],
  ["sq", "Albanian"],
  ["mk", "Macedonian"],
  ["ka", "Georgian"],
  ["hy", "Armenian"],
  ["az", "Azerbaijani"],
  ["kk", "Kazakh"],
  ["uz", "Uzbek"],
  ["mn", "Mongolian"],
  ["ne", "Nepali"],
  ["si", "Sinhala"],
  ["my", "Myanmar"],
  ["km", "Khmer"],
  ["lo", "Lao"],
  ["la", "Latin"],
  ["eo", "Esperanto"],
];
const LANG_NAME = new Map(LANGS);
const COLOR_PRESETS = [
  ["Default", ACCENT],
  ["Red", "#ED4245"],
  ["Orange", "#F07B3E"],
  ["Gold", "#F1C40F"],
  ["Green", "#43B581"],
  ["Teal", "#1ABC9C"],
  ["Blue", "#3498DB"],
  ["Indigo", "#5865F2"],
  ["Purple", "#9B59B6"],
  ["Pink", "#EB459E"],
  ["Gray", "#80848E"],
];
const { useStore: useQuickTranslate } = createPluginStore("quicktranslate", {
  settingsVersion: 13,
  targetOut: "en",
  targetIn: "en",
  sourceOut: "auto",
  immersive: true,
  translationColor: ACCENT,
  showButton: true,
  draftBeforeSend: true,
  saveHistory: true,
  rememberLanguagesPerChat: true,
  chatLanguages: {},
  highlightDraftButton: true,
  keepArmed: true,
  hideGiftButton: true,
  provider: "google",
  deeplApiKey: "",
  anchor: "actions",
  favLangs: ["en", "es", "fr", "de", "ro"],
  showSourceLanguage: false,
  autoChannelIds: [],
  autoIncomingImmersive: true,
  protectedWords: [],
  wordLanguageRules: [],
  historyEntries: [],
  cacheEntries: [],
  keepMessageTranslations: true,
  messageTranslations: [],
});
const qt = new Proxy(Object.create(null), {
  get(_target, prop) {
    return Reflect.get(useQuickTranslate.getState(), prop);
  },
});
const updateQuickTranslateSettings = (patch) =>
  useQuickTranslate.getState().updateSettings(patch);
const translations = new Map();
const pendingRowUpdates = new Set();
const cache = new Map();
const wordCache = new Map();
const inFlight = new Map();
const providerCooldownUntil = new Map();
let pendingRequestCount = 0;
let cacheGeneration = 0;
const autoSeen = new Set();
const unpatches = [];
const bridge = { text: "", change: null, inst: null, seen: 0 };
const refWrappers = new WeakMap();
const buttonListeners = new Set();
let armed = null;
let lastChannelId = null;
let lastOriginal = null;
let lastOriginalChannelId = null;
let renderErrors = 0;
let renderUnpatch = null;
let pluginStarted = false;
let ThemeStore;
let persistentReady = false;
let historyEntries = [];
let requestTail = Promise.resolve();
let lastRequestAt = 0;
let bulkSelectionRequest = null;
let bulkSelectionNonce = 0;
let pendingMessageRequest = null;
let messageRequestNonce = 0;
const toast = (t) => {
  try {
    showToast(t);
  } catch (_) {
    /* ignore */
  }
};
const safe = (fn, fallback) => {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
};
const trimMap = (m, max) => {
  while (m.size > max) m.delete(m.keys().next().value);
};
const langName = (code) =>
  code === "auto" ? "Auto-detect" : LANG_NAME.get(code) || code;
const notifyButton = () =>
  buttonListeners.forEach((f) => {
    try {
      f();
    } catch (_) {
      /* ignore */
    }
  });
const getMessage = (c, id) =>
  safe(() => MessageStore.getMessage(c, id) || null, null);
const getChannel = (id) =>
  safe(() => (id ? ChannelStore.getChannel(id) : null), null);
const isDM = (ch) => !!ch && (ch.type === 1 || ch.type === 3);
const nameOf = (u) =>
  u ? u.globalName || u.global_name || u.username || "Unknown" : "Unknown";
function getChannelDisplayName(channelId) {
  const channel = getChannel(channelId);
  if (!channel) return channelId ? "Unavailable channel" : "Draft (not sent)";
  if (isDM(channel)) {
    const recipients = Array.isArray(channel.recipients)
      ? channel.recipients
      : [];
    const names = recipients.map((id) =>
      nameOf(safe(() => UserStore.getUser(String(id)), null)),
    );
    return channel.name || names.join(", ") || "Direct message";
  }
  return channel.name ? "# " + channel.name : "Channel";
}
function currentChannelId() {
  return safe(
    () =>
      SelectedChannelStore.getChannelId?.() ??
      SelectedChannelStore.getCurrentlySelectedChannelId?.() ??
      null,
    null,
  );
}
function getChatLanguages(channelId = currentChannelId()) {
  const stored =
    channelId && qt.rememberLanguagesPerChat !== false
      ? qt.chatLanguages?.[channelId]
      : null;
  return {
    sourceOut: stored?.sourceOut || qt.sourceOut || "auto",
    targetOut: stored?.targetOut || qt.targetOut || "en",
  };
}
function saveChatLanguages(channelId, patch) {
  if (!channelId || qt.rememberLanguagesPerChat === false) {
    const globalPatch = {};
    if (patch.sourceOut) globalPatch.sourceOut = patch.sourceOut;
    if (patch.targetOut) globalPatch.targetOut = patch.targetOut;
    useQuickTranslate.getState().updateSettings(globalPatch);
    return;
  }
  const chatLanguages = Object.assign(
    {},
    useQuickTranslate.getState().chatLanguages || {},
  );
  chatLanguages[channelId] = Object.assign(
    {},
    chatLanguages[channelId] || getChatLanguages(channelId),
    patch,
  );
  useQuickTranslate.getState().updateSettings({ chatLanguages });
}
function persistLocalData() {
  if (!persistentReady) return;
  try {
    useQuickTranslate.getState().updateSettings({
      historyEntries: historyEntries.slice(0, MAX_HISTORY),
      cacheEntries: Array.from(cache.entries()).slice(-MAX_CACHE),
    });
  } catch (_) {
    /* settings may still be hydrating */
  }
}
function clearTranslationData() {
  const state = useQuickTranslate.getState();
  const historyCount = historyEntries.length;
  const cacheCount = Math.max(
    cache.size,
    Array.isArray(state.cacheEntries) ? state.cacheEntries.length : 0,
  );
  cacheGeneration++;
  cache.clear();
  wordCache.clear();
  inFlight.clear();
  historyEntries = [];
  cancelRequests();
  const previous = Array.from(translations.entries());
  translations.clear();
  state.updateSettings({
    historyEntries: [],
    cacheEntries: [],
    messageTranslations: [],
  });
  for (const [id, entry] of previous) if (entry.ch) refreshRow(entry.ch, id);
  persistLocalData();
  toast(
    `Translation history, saved message translations and cache cleared (${historyCount} history, ${cacheCount} cached)`,
  );
}
function hydrateLocalData() {
  const generationAtStart = cacheGeneration;
  const load = () => {
    const state = useQuickTranslate.getState();
    historyEntries = Array.isArray(state.historyEntries)
      ? state.historyEntries
          .filter(
            (x) =>
              x &&
              typeof x.original === "string" &&
              typeof x.translated === "string",
          )
          .slice(0, MAX_HISTORY)
      : [];
    cache.clear();
    wordCache.clear();
    if (
      generationAtStart === cacheGeneration &&
      Array.isArray(state.cacheEntries)
    ) {
      for (const entry of state.cacheEntries.slice(-MAX_CACHE)) {
        if (
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          entry[1] &&
          typeof entry[1].text === "string"
        )
          cache.set(entry[0], entry[1]);
      }
    }
    persistentReady = true;
    restoreMessageTranslations();
    persistLocalData();
  };
  const state = useQuickTranslate.getState();
  if (state._hasHydrated) {
    load();
    return;
  }
  const unsubscribe = useQuickTranslate.subscribe((next) => {
    if (!next._hasHydrated) return;
    unsubscribe();
    load();
  });
  unpatches.push(unsubscribe);
}
function restoreMessageTranslations() {
  const state = useQuickTranslate.getState();
  if (
    state.keepMessageTranslations === false ||
    !Array.isArray(state.messageTranslations)
  )
    return;
  const restoredIds = new Set();
  for (const entry of state.messageTranslations.slice(0, MAX_TRANSLATIONS)) {
    if (
      !entry ||
      typeof entry.messageId !== "string" ||
      typeof entry.channelId !== "string" ||
      typeof entry.translated !== "string"
    )
      continue;
    const entryId = entry.channelId + "|" + entry.messageId;
    if (restoredIds.has(entryId)) continue;
    restoredIds.add(entryId);
    translations.set(entry.messageId, {
      text: entry.translated,
      src: entry.source || "auto",
      tl: entry.target || "en",
      at: Number(entry.at) || Date.now(),
      ch: entry.channelId,
      provider: entry.provider || "google",
      immersive: entry.immersive,
      autoIncoming: !!entry.autoIncoming,
    });
  }
  trimMap(translations, MAX_TRANSLATIONS);
  for (const entry of state.messageTranslations.slice(0, MAX_TRANSLATIONS)) {
    if (
      entry &&
      entry.channelId &&
      entry.messageId &&
      getMessage(entry.channelId, entry.messageId)
    )
      refreshRow(entry.channelId, entry.messageId);
  }
}
function saveMessageTranslation(
  message,
  result,
  target,
  channelId,
  autoIncoming,
  immersiveOverride,
) {
  const state = useQuickTranslate.getState();
  if (
    state.keepMessageTranslations === false ||
    !message?.id ||
    !channelId ||
    !result?.text
  )
    return;
  const messageId = String(message.id);
  const channel = String(channelId);
  const id = channel + "|" + messageId;
  const entries = Array.isArray(state.messageTranslations)
    ? state.messageTranslations
    : [];
  const next = [
    {
      id,
      messageId,
      channelId: channel,
      original: String(message.content || ""),
      translated: result.text,
      source: result.src || "auto",
      target,
      at: Date.now(),
      provider: result.provider || qt.provider || "google",
      autoIncoming: !!autoIncoming,
      immersive: immersiveOverride,
    },
    ...entries.filter((entry) => entry?.id !== id),
  ].slice(0, MAX_TRANSLATIONS);
  state.updateSettings({ messageTranslations: next });
}
function addHistory(
  original,
  translated,
  result,
  target,
  channelId = currentChannelId(),
  messageId = null,
) {
  if (
    !persistentReady ||
    qt.saveHistory === false ||
    !translated ||
    result.same
  )
    return;
  const provider = result.provider || qt.provider || "google";
  const id = [
    channelId || "draft",
    messageId || "",
    provider,
    result.src || "auto",
    target,
    original,
  ].join("|");
  historyEntries = historyEntries.filter((item) => item.id !== id);
  historyEntries.unshift({
    id,
    original,
    translated,
    source: result.src || "auto",
    target,
    provider,
    at: Date.now(),
    channelId,
    channelName: getChannelDisplayName(channelId),
    messageId,
  });
  historyEntries = historyEntries.slice(0, MAX_HISTORY);
  persistLocalData();
}
function enqueueRequest(work, automatic = false) {
  if (automatic && pendingRequestCount >= MAX_PENDING_AUTO_REQUESTS)
    return Promise.reject(
      new Error(
        "Automatic translation skipped because the request queue is busy",
      ),
    );
  pendingRequestCount++;
  const generation = cacheGeneration;
  const task = requestTail
    .catch(() => undefined)
    .then(async () => {
      if (!isRunning() || generation !== cacheGeneration)
        throw new Error("Translation cancelled");
      const wait = Math.max(0, REQUEST_GAP - (Date.now() - lastRequestAt));
      if (wait) await waitForTurn(wait);
      if (!isRunning() || generation !== cacheGeneration)
        throw new Error("Translation cancelled");
      lastRequestAt = Date.now();
      return work();
    });
  requestTail = task.then(
    () => {
      if (generation === cacheGeneration)
        pendingRequestCount = Math.max(0, pendingRequestCount - 1);
    },
    () => {
      if (generation === cacheGeneration)
        pendingRequestCount = Math.max(0, pendingRequestCount - 1);
    },
  );
  return task;
}
function palette() {
  const light = safe(() => {
    ThemeStore = ThemeStore || findByStoreName("ThemeStore");
    return !!ThemeStore && ThemeStore.theme === "light";
  }, false);
  return light
    ? {
        text: "#060607",
        sub: "#5C5E66",
        bg: "#FFFFFF",
        card: "#F2F3F5",
        blurple: "#5865F2",
        card2: "rgba(0,0,0,0.045)",
        chip: "rgba(0,0,0,0.07)",
        press: "rgba(0,0,0,0.06)",
        off: "#B5BAC1",
      }
    : {
        text: "#FFFFFF",
        sub: "#B5BAC1",
        bg: "#1E1F22",
        card: "#2B2D31",
        blurple: "#5865F2",
        card2: "rgba(255,255,255,0.06)",
        chip: "rgba(255,255,255,0.10)",
        press: "rgba(255,255,255,0.07)",
        off: "#4E5058",
      };
}
const translationColor = () =>
  HEX.test(String(qt.translationColor || ""))
    ? String(qt.translationColor).toUpperCase()
    : ACCENT;
const LANGUAGE_FLAGS = {
  en: "🇺🇸",
  ro: "🇷🇴",
  es: "🇪🇸",
  fr: "🇫🇷",
  de: "🇩🇪",
  it: "🇮🇹",
  pt: "🇧🇷",
  ru: "🇷🇺",
  uk: "🇺🇦",
  pl: "🇵🇱",
  nl: "🇳🇱",
  tr: "🇹🇷",
  ar: "🇸🇦",
  he: "🇮🇱",
  hi: "🇮🇳",
  ja: "🇯🇵",
  ko: "🇰🇷",
  "zh-CN": "🇨🇳",
  "zh-TW": "🇹🇼",
  id: "🇮🇩",
  th: "🇹🇭",
  vi: "🇻🇳",
  sv: "🇸🇪",
  da: "🇩🇰",
  no: "🇳🇴",
  fi: "🇫🇮",
  cs: "🇨🇿",
  sk: "🇸🇰",
  hu: "🇭🇺",
  el: "🇬🇷",
  bg: "🇧🇬",
  sr: "🇷🇸",
  hr: "🇭🇷",
  sl: "🇸🇮",
  lt: "🇱🇹",
  lv: "🇱🇻",
  et: "🇪🇪",
  fa: "🇮🇷",
  bn: "🇧🇩",
  ur: "🇵🇰",
  ms: "🇲🇾",
  sw: "🇰🇪",
  af: "🇿🇦",
  tl: "🇵🇭",
  is: "🇮🇸",
  ga: "🇮🇪",
};
const languageLabel = (code, name = langName(code)) =>
  (LANGUAGE_FLAGS[code] ? LANGUAGE_FLAGS[code] + "  " : "") + name;
/* ---- Quick Translate settings components ---- */
/* ---- end shared kit ---- */
function copyText(text) {
  try {
    clipboard.setString(text);
    toast("Copied");
  } catch (_) {
    toast("Could not copy");
  }
}
/* ------------------------------------------------------------------ */
/* translation engine                                                  */
/* ------------------------------------------------------------------ */
function fetchT(url, opts) {
  return fetchWithTimeout(url, opts);
}
function responseError(message, response, json) {
  const error = new Error(
    (json?.message || message) + " (HTTP " + response.status + ")",
  );
  error.status = response.status;
  const retryAfter = safe(() => response.headers?.get("Retry-After"), null);
  const seconds = Number(retryAfter);
  const dateMs =
    retryAfter && !Number.isFinite(seconds)
      ? Date.parse(retryAfter) - Date.now()
      : 0;
  error.retryAfterMs =
    Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : dateMs > 0
        ? dateMs
        : DEFAULT_429_COOLDOWN;
  return error;
}
function callApi(provider, text, tl, sl) {
  if (provider === "deepl") {
    const key = String(qt.deeplApiKey || "").trim();
    if (!key)
      return Promise.reject(
        new Error("Add your DeepL API key in Quick Translate settings"),
      );
    const endpoint = key.endsWith(":fx")
      ? "https://api-free.deepl.com/v2/translate"
      : "https://api.deepl.com/v2/translate";
    const deeplCode = (code) =>
      code === "zh-CN" || code === "zh-TW"
        ? "ZH"
        : code === "no"
          ? "NB"
          : code.toUpperCase();
    const target =
      tl === "en"
        ? "EN-US"
        : tl === "pt"
          ? "PT-BR"
          : tl === "zh-CN"
            ? "ZH-HANS"
            : tl === "zh-TW"
              ? "ZH-HANT"
              : deeplCode(tl);
    const source = sl && sl !== "auto" ? deeplCode(sl) : undefined;
    const body = { text: [text], target_lang: target };
    if (source) body.source_lang = source;
    return fetchT(endpoint, {
      method: "POST",
      headers: {
        Authorization: "DeepL-Auth-Key " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw responseError("DeepL request failed", res, json);
        return json;
      })
      .then((json) => {
        const result = json?.translations?.[0];
        if (!result?.text)
          throw new Error(
            json?.message || "DeepL returned an empty translation",
          );
        return {
          text: String(result.text),
          src: String(
            result.detected_source_language || source || "auto",
          ).toLowerCase(),
        };
      });
  }
  const params =
    "client=gtx&dt=t&sl=" +
    encodeURIComponent(sl || "auto") +
    "&tl=" +
    encodeURIComponent(tl);
  const base = "https://translate.googleapis.com/translate_a/single?" + params;
  const req =
    text.length < 1200
      ? fetchT(base + "&q=" + encodeURIComponent(text))
      : fetchT(base, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: "q=" + encodeURIComponent(text),
        });
  return req
    .then((res) => {
      if (!res.ok)
        throw responseError("Google Translate request failed", res, null);
      return res.json();
    })
    .then((json) => {
      const segments =
        Array.isArray(json) && Array.isArray(json[0]) ? json[0] : [];
      const out = segments.map((s) => (s && s[0]) || "").join("");
      if (!out && text.trim()) throw new Error("Empty response");
      return {
        text: out,
        src:
          (Array.isArray(json) && typeof json[2] === "string" && json[2]) || sl,
      };
    });
}
function providerLabel(provider) {
  return provider === "deepl" ? "DeepL" : "Google Translate";
}
function translationComplete(result) {
  const showProvider = !!String(qt.deeplApiKey || "").trim();
  const fallback = qt.provider === "deepl" && result.provider === "google";
  let label = showProvider
    ? "Translated with " +
      providerLabel(result.provider) +
      (fallback ? " (DeepL fallback)" : "")
    : "Translated";
  if (!qt.showSourceLanguage) {
    const raw = String(result.src || "")
      .trim()
      .replace(/_/g, "-")
      .toLowerCase();
    const code =
      raw === "zh-tw" || raw === "zh-hant"
        ? "zh-TW"
        : raw === "zh" || raw === "zh-cn" || raw === "zh-hans"
          ? "zh-CN"
          : raw.split("-")[0];
    const source = LANG_NAME.get(code);
    if (source) label += (showProvider ? " · from " : " from ") + source;
  }
  toast(label);
}
function prettyToken(t) {
  if (/^<a?:[\w~]+:\d+>$/.test(t)) return t;
  let m;
  if ((m = /^<@!?(\d+)>$/.exec(t)))
    return "@" + nameOf(safe(() => UserStore.getUser(m[1]), null));
  if ((m = /^<#(\d+)>$/.exec(t)))
    return "#" + ((getChannel(m[1]) || {}).name || "channel");
  if (/^<@&\d+>$/.test(t)) return "@role";
  if (/^<t:/.test(t)) return "";
  return t;
}
function isWordChar(ch) {
  return !!ch && (/[0-9_]/.test(ch) || ch.toLowerCase() !== ch.toUpperCase());
}
function protect(text) {
  const tokens = [];
  const hold = (m) => {
    tokens.push(m);
    return "§" + (tokens.length - 1) + "§";
  };
  // Text that already looks like one of our placeholders is kept verbatim.
  let out = text.replace(/§\s*\d+\s*§/g, hold).replace(PROTECT, hold);
  const words = Array.isArray(qt.protectedWords) ? qt.protectedWords : [];
  for (const raw of words) {
    const word = String(raw || "").trim();
    if (!word) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const first = word[0],
      last = word[word.length - 1];
    out = out.replace(new RegExp(escaped, "gi"), (m, offset, whole) => {
      // Word boundaries only where the word edge is a letter/digit; works for Cyrillic, symbols and CJK.
      if (isWordChar(first) && isWordChar(whole[offset - 1])) return m;
      if (isWordChar(last) && isWordChar(whole[offset + m.length])) return m;
      return hold(m);
    });
  }
  return { out, tokens };
}
function restore(text, tokens, pretty) {
  const used = new Set();
  let out = text.replace(/§\s*(\d+)\s*§/g, (m, i) => {
    const t = tokens[Number(i)];
    if (t === undefined) return m;
    used.add(Number(i));
    return pretty ? prettyToken(t) : t;
  });
  if (!pretty) {
    const missing = tokens.filter((_, i) => !used.has(i));
    if (missing.length) out += " " + missing.join(" ");
  }
  return out;
}
function translate(
  text,
  tl,
  sl,
  pretty,
  channelId = currentChannelId(),
  messageId = null,
  automatic = false,
) {
  const source = sl || "auto";
  const rules =
    source === "auto"
      ? (Array.isArray(qt.wordLanguageRules) ? qt.wordLanguageRules : [])
          .filter((rule) => rule?.word?.trim() && LANG_NAME.has(rule.language))
          .slice(0, 100)
      : [];
  const protectedWordsKey = (
    Array.isArray(qt.protectedWords) ? qt.protectedWords : []
  )
    .map((word) => String(word).toLowerCase().trim())
    .filter(Boolean)
    .sort()
    .join(",");
  const cacheKey = JSON.stringify([
    qt.provider || "google",
    pretty,
    source,
    tl,
    protectedWordsKey,
    rules.map((rule) => [rule.word, rule.language]),
    text,
  ]);
  const generation = cacheGeneration;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    addHistory(text, cached.text, cached, tl, channelId, messageId);
    return Promise.resolve(cached);
  }
  if (inFlight.has(cacheKey))
    return inFlight.get(cacheKey).then((result) => {
      if (generation === cacheGeneration)
        addHistory(text, result.text, result, tl, channelId, messageId);
      return result;
    });
  const { out, tokens } = protect(text);
  if (!out.replace(/§\d+§/g, "").trim())
    return Promise.resolve({ same: true, text, src: source });
  const selectedProvider = qt.provider || "google";
  const requestPart = (provider, fragment, fragmentSource) => {
    const cooldownUntil = providerCooldownUntil.get(provider) || 0;
    const paused = (until) =>
      Object.assign(
        new Error(
          provider +
            " is paused after HTTP 429; retry in " +
            Math.ceil((until - Date.now()) / 1000) +
            "s",
        ),
        { status: 429 },
      );
    if (cooldownUntil > Date.now())
      return Promise.reject(paused(cooldownUntil));
    return enqueueRequest(async () => {
      const queuedCooldown = providerCooldownUntil.get(provider) || 0;
      if (queuedCooldown > Date.now()) throw paused(queuedCooldown);
      try {
        return await callApi(provider, fragment, tl, fragmentSource);
      } catch (error) {
        if (Number(error?.status) === 429)
          providerCooldownUntil.set(
            provider,
            Date.now() +
              Math.max(DEFAULT_429_COOLDOWN, Number(error.retryAfterMs) || 0),
          );
        throw error;
      }
    }, automatic);
  };
  const runProvider = async (provider) => {
    const prepared = await prepareWordRules(
      out,
      tokens,
      rules,
      tl,
      async (word, language) => {
        const key = JSON.stringify([provider, word, language, tl]);
        if (wordCache.has(key)) return wordCache.get(key);
        const result = await requestPart(provider, word, language);
        if (!isRunning() || generation !== cacheGeneration)
          throw new Error("Translation cancelled");
        wordCache.set(key, result.text);
        trimMap(wordCache, MAX_CACHE);
        return result.text;
      },
    );
    const result = prepared.out.replace(/§\s*\d+\s*§/g, "").trim()
      ? await requestPart(provider, prepared.out, source)
      : { text: prepared.out, src: prepared.source || source };
    if (prepared.applied) {
      for (let index = tokens.length; index < prepared.tokens.length; index++) {
        const marker = new RegExp("§\\s*" + index + "\\s*§", "g");
        if ((result.text.match(marker) || []).length !== 1)
          throw new Error("Translation provider changed a word-rule marker");
      }
    }
    return {
      ...result,
      provider,
      tokens: prepared.tokens,
      ruleApplied: prepared.applied,
    };
  };
  const request = (
    selectedProvider !== "deepl"
      ? runProvider("google")
      : runProvider("deepl").catch((deeplError) => {
          if (
            !isRunning() ||
            generation !== cacheGeneration ||
            Number(deeplError?.status) === 429
          )
            throw deeplError;
          return runProvider("google").catch((googleError) => {
            throw new Error(
              "DeepL and Google failed: " +
                (googleError?.message ||
                  deeplError?.message ||
                  "request failed"),
            );
          });
        })
  ).then((res) => {
    if (!pluginStarted || generation !== cacheGeneration)
      throw new Error("Translation cancelled");
    const base = String(tl).toLowerCase().split("-")[0],
      detected = String(res.src || "")
        .toLowerCase()
        .split("-")[0];
    const translated = restore(res.text, res.tokens, pretty);
    const same =
      source === "auto" &&
      ((!res.ruleApplied &&
        (!detected || detected === "auto" || detected === base)) ||
        translated === text);
    const result = {
      same,
      text: same ? text : translated,
      src: res.src,
      provider: res.provider,
    };
    cache.set(cacheKey, result);
    trimMap(cache, MAX_CACHE);
    addHistory(text, result.text, result, tl, channelId, messageId);
    return result;
  });
  inFlight.set(cacheKey, request);
  const remove = () => {
    if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
  };
  request.then(remove, remove);
  return request;
}
/* ------------------------------------------------------------------ */
/* chat input bridge (reads / writes the text box)                     */
/* ------------------------------------------------------------------ */
function isChatInput(props) {
  const ph = typeof props.placeholder === "string" ? props.placeholder : "";
  if (
    ph &&
    /^(message|mesaj|mensaje|nachricht|messag|написать|сообщение)/i.test(ph)
  )
    return true;
  const ch = getChannel(currentChannelId());
  if (!ch) return false;
  let name = ch.name;
  if (isDM(ch) && !name) {
    const rid = ch.recipients && ch.recipients[0];
    name = rid ? nameOf(safe(() => UserStore.getUser(rid), null)) : null;
  }
  if (
    name &&
    name !== "Unknown" &&
    ph.toLowerCase().includes(String(name).toLowerCase())
  )
    return true;
  // Discord's composer is a multiline, send-enabled input, including in DMs where
  // the placeholder may be omitted by the current Discord build.
  return (
    !!props.multiline &&
    typeof props.onChangeText === "function" &&
    (typeof props.onSubmitEditing === "function" ||
      props.returnKeyType === "send" ||
      props.maxLength === 2000)
  );
}
function installInputCapture() {
  const TI = RN.TextInput;
  if (!TI || typeof TI.render !== "function") return;
  unpatches.push(
    before("render", TI, (args) => {
      try {
        const props = args[0];
        if (!props || !isChatInput(props)) return;
        bridge.seen = Date.now();
        const original = props.onChangeText;
        bridge.change = typeof original === "function" ? original : null;
        if (typeof props.value === "string") bridge.text = props.value;
        args[0] = Object.assign({}, props, {
          onChangeText: (t) => {
            bridge.text = t;
            if (original) original(t);
          },
        });
        const ref = args[1];
        let wrapped =
          ref && typeof ref === "object" ? refWrappers.get(ref) : null;
        if (!wrapped) {
          wrapped = (inst) => {
            bridge.inst = inst;
            if (typeof ref === "function") ref(inst);
            else if (ref && typeof ref === "object") ref.current = inst;
          };
          if (ref && typeof ref === "object") refWrappers.set(ref, wrapped);
        }
        args[1] = wrapped;
      } catch (_) {
        /* ignore */
      }
    }),
  );
}
function composerRef() {
  const channelId = currentChannelId();
  if (!channelId) return null;
  const api = safe(() => findByProps("getChatInputRef"), null);
  return safe(() => api?.getChatInputRef?.(channelId, 0), null);
}
function readInput() {
  if (Date.now() - bridge.seen < 600000 && String(bridge.text || "").trim())
    return String(bridge.text);
  const ref = composerRef();
  const value = safe(
    () =>
      typeof ref?.getText === "function"
        ? ref.getText()
        : typeof ref?.getValue === "function"
          ? ref.getValue()
          : typeof ref?.text === "string"
            ? ref.text
            : typeof ref?.value === "string"
              ? ref.value
              : typeof ref?.props?.value === "string"
                ? ref.props.value
                : "",
    "",
  );
  return typeof value === "string" ? value : "";
}
function writeInput(text) {
  let ok = false;
  if (bridge.change) {
    try {
      bridge.change(text);
      ok = true;
    } catch (_) {
      /* ignore */
    }
  }
  if (bridge.inst && typeof bridge.inst.setNativeProps === "function") {
    try {
      bridge.inst.setNativeProps({ text });
      ok = true;
    } catch (_) {
      /* ignore */
    }
  }
  if (!ok) {
    const ref = composerRef();
    try {
      if (typeof ref?.setText === "function") {
        ref.setText(text);
        ok = true;
      } else if (typeof ref?.setValue === "function") {
        ref.setValue(text);
        ok = true;
      } else if (typeof ref?.setNativeProps === "function") {
        ref.setNativeProps({ text });
        ok = true;
      } else if (
        typeof ref?.clear === "function" &&
        typeof ref?.insertText === "function"
      ) {
        ref.clear();
        ref.insertText(text);
        ok = true;
      }
    } catch (_) {
      /* use the captured TextInput bridge when available */
    }
  }
  if (ok) bridge.text = text;
  return ok;
}
function translateCurrentText(tl, sl) {
  const text = readInput();
  if (!text.trim()) {
    toast("Type a message in the chat box first");
    return Promise.resolve(false);
  }
  if (!(bridge.change || bridge.inst || composerRef())) {
    toast(
      "Discord could not access the message box; reopen the chat and try again",
    );
    return Promise.resolve(false);
  }
  const channelId = currentChannelId();
  return translate(text, tl, sl, false, channelId)
    .then((result) => {
      if (
        !pluginStarted ||
        currentChannelId() !== channelId ||
        readInput() !== text
      ) {
        toast(
          "The draft or conversation changed; the original text was left untouched",
        );
        return false;
      }
      if (result.same) {
        armed = null;
        notifyButton();
        toast("Already in " + langName(tl));
        return false;
      }
      if (writeInput(result.text)) {
        lastOriginal = text;
        lastOriginalChannelId = currentChannelId();
        translationComplete(result);
        return true;
      } else
        toast("Could not update the chat box; the original text is unchanged");
      return false;
    })
    .catch((error) => {
      toast("Translation failed: " + (error?.message || error));
      return false;
    });
}
function restoreOriginal() {
  if (lastOriginal == null) {
    toast("Nothing to restore");
    return;
  }
  if (lastOriginalChannelId && currentChannelId() !== lastOriginalChannelId) {
    toast("Open the original conversation before restoring this draft");
    return;
  }
  if (writeInput(lastOriginal)) {
    lastOriginal = null;
    lastOriginalChannelId = null;
  } else toast("Could not write to the chat box");
}
function patchSend() {
  unpatches.push(
    observeProps(["sendMessage", "receiveMessage"], (Messages) => {
      unpatches.push(
        instead("sendMessage", Messages, (args, orig) => {
          const jobGeneration = cacheGeneration;
          let pending = null;
          let oneShotJob = null;
          let oneShotTranslated = false;
          try {
            const msg = args[1];
            const job = qt.draftBeforeSend === false ? armed : null;
            if (
              job &&
              msg &&
              typeof msg.content === "string" &&
              msg.content.trim()
            ) {
              if (job.oneShot) oneShotJob = job;
              else if (!qt.keepArmed) {
                armed = null;
                notifyButton();
              }
              pending = translate(
                msg.content,
                job.tl,
                job.sl,
                false,
                currentChannelId(),
              ).then((r) => {
                if (!r.same) {
                  args[1] = Object.assign({}, msg, { content: r.text });
                  translationComplete(r);
                  if (job.oneShot) oneShotTranslated = true;
                }
              });
            }
          } catch (_) {
            toast("Translation failed, sent the original message");
          }
          const send = () => {
            if (!pluginStarted || jobGeneration !== cacheGeneration)
              throw new Error(
                "Translation cancelled: plugin stopped or data cleared",
              );
            const msg = args[1];
            const clearRestore = () => {
              if (
                lastOriginal != null &&
                msg &&
                (String(args[0]) === String(lastOriginalChannelId || "") ||
                  currentChannelId() === lastOriginalChannelId)
              ) {
                lastOriginal = null;
                lastOriginalChannelId = null;
              }
              bridge.text = "";
              if (oneShotJob && oneShotTranslated) {
                armed = oneShotJob.resume || null;
                notifyButton();
              }
            };
            const result = orig(...args);
            if (result && typeof result.then === "function")
              return result.then((value) => {
                clearRestore();
                return value;
              });
            clearRestore();
            return result;
          };
          if (!pending) return send();
          return pending
            .catch(() => {
              toast("Translation failed, sent the original message");
            })
            .then(send);
        }),
      );
    }),
  );
}
/* ------------------------------------------------------------------ */
/* translated messages in the chat                                     */
/* ------------------------------------------------------------------ */
function refreshRow(channelId, id) {
  const msg = getMessage(channelId, id);
  if (!msg) return;
  const guildId = safe(() => getChannel(channelId).guild_id, undefined);
  pendingRowUpdates.add(String(id));
  while (pendingRowUpdates.size > MAX_TRANSLATIONS)
    pendingRowUpdates.delete(pendingRowUpdates.values().next().value);
  try {
    FluxDispatcher.dispatch({
      type: "MESSAGE_UPDATE",
      guildId,
      message: {
        id: String(id),
        channel_id: String(channelId),
        guild_id: guildId,
      },
    });
  } catch (error) {
    console.warn("[QuickTranslate] Could not refresh message", error);
  }
}
function translateMessage(
  message,
  tl,
  silent = false,
  immersiveOverride,
  autoIncoming = false,
  sourceOverride = "auto",
) {
  const text = message && message.content;
  if (typeof text !== "string" || !text.trim()) {
    if (!silent) toast("This message has no text");
    return Promise.resolve(false);
  }
  const channelId =
    message.channel_id || message.channelId || currentChannelId();
  return translate(
    text,
    tl,
    sourceOverride || "auto",
    true,
    channelId,
    message.id != null ? String(message.id) : null,
    autoIncoming,
  )
    .then((r) => {
      if (r.same) {
        if (!silent) toast("Already in " + langName(tl));
        return true;
      }
      translations.set(String(message.id), {
        text: r.text,
        src: r.src,
        tl,
        at: Date.now(),
        ch: channelId,
        provider: r.provider || qt.provider || "google",
        immersive: immersiveOverride,
        autoIncoming,
      });
      trimMap(translations, MAX_TRANSLATIONS);
      saveMessageTranslation(
        message,
        r,
        tl,
        String(channelId),
        autoIncoming,
        immersiveOverride,
      );
      setTimeout(() => refreshRow(channelId, message.id), silent ? 220 : 0);
      if (!silent) translationComplete(r);
      return true;
    })
    .catch((e) => {
      if (!silent)
        toast("Translation failed: " + (e && e.message ? e.message : e));
      return false;
    });
}
function onIncomingMessage(event) {
  try {
    const state = useQuickTranslate.getState();
    const message = event?.message;
    const channelId = String(event?.channelId || message?.channel_id || "");
    if (!message?.id || !channelId || !message.content?.trim()) return;
    if (message.type != null && message.type !== 0) return;
    const me = safe(
      () => UserStore.getCurrentUser?.()?.id || UserStore.getCurrentUserId?.(),
      null,
    );
    if (me && String(message.author?.id) === String(me)) {
      const draftEntry = historyEntries.find(
        (entry) =>
          !entry.messageId &&
          entry.channelId === channelId &&
          entry.translated === message.content &&
          Date.now() - entry.at < 10 * 60 * 1000,
      );
      if (draftEntry) {
        draftEntry.messageId = String(message.id);
        persistLocalData();
      }
      return;
    }
    if (!(state.autoChannelIds || []).map(String).includes(channelId)) return;
    const target = state.targetIn || "en";
    if (autoSeen.has(String(message.id))) return;
    autoSeen.add(String(message.id));
    if (autoSeen.size > 500) autoSeen.delete(autoSeen.values().next().value);
    translateMessage(message, target, true, undefined, true);
  } catch (_) {
    /* incoming translation must never affect message delivery */
  }
}
function messageArray(channelId) {
  const result = safe(() => MessageStore.getMessages(channelId), null);
  if (!result) return [];
  const value =
    safe(() => result.toArray(), null) ||
    result._array ||
    result.messages ||
    result;
  return Array.isArray(value) ? value : [];
}
const BULK_PAGE_SIZE = 30;
function bulkMessageCandidates(request, fetched = null) {
  const seed = request?.seedMessage;
  const all = [
    seed,
    ...(Array.isArray(fetched) ? fetched : messageArray(request?.channelId)),
  ].filter(
    (message) =>
      message?.id &&
      typeof message.content === "string" &&
      message.content.trim() &&
      (message.type == null || message.type === 0),
  );
  const unique = new Map();
  for (const message of all) unique.set(String(message.id), message);
  return Array.from(unique.values()).sort(
    (a, b) =>
      String(b.id).length - String(a.id).length ||
      String(b.id).localeCompare(String(a.id)),
  );
}
function fetchBulkMessagePage(channelId, before) {
  return readHistoryPage(
    String(channelId),
    before ? String(before) : null,
    BULK_PAGE_SIZE,
  ).catch(() => null);
}
function openBulkSelection(message) {
  const channelId = String(
    message?.channel_id || message?.channelId || currentChannelId() || "",
  );
  if (!channelId) {
    toast("Could not find this message’s channel");
    return;
  }
  bulkSelectionRequest = {
    channelId,
    seedMessage: message,
    nonce: ++bulkSelectionNonce,
  };
  notifyButton();
}
function BulkMessageSelector(props) {
  const h = React.createElement;
  const C = palette();
  const [selected, setSelected] = React.useState(() =>
    props.request.seedMessage?.id ? [String(props.request.seedMessage.id)] : [],
  );
  const [busy, setBusy] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const seed = props.request.seedMessage;
  const seedId = String(seed?.id || "");
  const visiblePageSize = seedId ? BULK_PAGE_SIZE - 1 : BULK_PAGE_SIZE;
  const initialMessages = bulkMessageCandidates(props.request);
  const initialPage = initialMessages
    .filter((m) => String(m.id) !== seedId)
    .slice(0, visiblePageSize);
  const [messages, setMessages] = React.useState(
    seed ? [seed, ...initialPage] : initialPage,
  );
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(true);
  const loadLock = React.useRef(false);
  const cursor = React.useRef(initialPage[initialPage.length - 1]?.id || null);
  const activeLoad = React.useRef(0);
  const [loadError, setLoadError] = React.useState("");
  React.useEffect(() => {
    const generation = ++activeLoad.current;
    setSelected(seedId ? [seedId] : []);
    setQuery("");
    setBusy(false);
    setLoadingMore(true);
    setLoadError("");
    loadLock.current = true;
    fetchBulkMessagePage(props.request.channelId, null).then((page) => {
      if (activeLoad.current !== generation) return;
      const all = bulkMessageCandidates(props.request, page?.messages ?? null);
      const latest = all
        .filter((m) => String(m.id) !== seedId)
        .slice(0, visiblePageSize);
      const selectedSeed = all.find((m) => String(m.id) === seedId) || seed;
      setMessages(selectedSeed ? [selectedSeed, ...latest] : latest);
      cursor.current = latest[latest.length - 1]?.id || seedId || null;
      setHasMore(
        page
          ? page.hasMore || all.length > latest.length + (selectedSeed ? 1 : 0)
          : true,
      );
      if (!page) setLoadError("Could not load messages. Scroll down to retry.");
      setLoadingMore(false);
      loadLock.current = false;
    });
    return () => {
      activeLoad.current++;
    };
  }, [props.request.nonce]);
  const loadMore = async () => {
    if (loadLock.current || !hasMore) return;
    const generation = activeLoad.current;
    loadLock.current = true;
    setLoadingMore(true);
    setLoadError("");
    const currentCursor = cursor.current;
    const page = await fetchBulkMessagePage(
      props.request.channelId,
      currentCursor,
    );
    if (activeLoad.current !== generation) return;
    if (!page) {
      setLoadError("Could not load older messages. Scroll down to retry.");
      setLoadingMore(false);
      loadLock.current = false;
      return;
    }
    const currentIds = new Set(messages.map((m) => String(m.id)));
    const all = bulkMessageCandidates(props.request, page.messages);
    const older = all
      .filter(
        (m) =>
          currentCursor &&
          String(m.id).length <= String(currentCursor).length &&
          (String(m.id).length < String(currentCursor).length ||
            String(m.id) < String(currentCursor)) &&
          !currentIds.has(String(m.id)),
      )
      .slice(0, BULK_PAGE_SIZE);
    setMessages((current) => {
      const ids = new Set(current.map((m) => String(m.id)));
      return current.concat(older.filter((m) => !ids.has(String(m.id))));
    });
    cursor.current =
      page.before || older[older.length - 1]?.id || currentCursor;
    setHasMore(page.hasMore || older.length >= BULK_PAGE_SIZE);
    setLoadingMore(false);
    loadLock.current = false;
  };
  const onListScroll = (event) => {
    const native = event?.nativeEvent || {};
    const layout = native.layoutMeasurement || {};
    const offset = native.contentOffset || {};
    const size = native.contentSize || {};
    if (
      Number(offset.y || 0) + Number(layout.height || 0) >=
      Number(size.height || 0) - 96
    )
      loadMore();
  };
  const q = query.trim().toLowerCase();
  const visible = messages.filter(
    (m) => !q || String(m.content).toLowerCase().includes(q),
  );
  const isAll =
    visible.length > 0 && visible.every((m) => selected.includes(String(m.id)));
  const toggle = (message) => {
    const id = String(message.id);
    setSelected((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.concat(id),
    );
  };
  const run = () => {
    const byId = new Map(messages.map((m) => [String(m.id), m]));
    const chosen = selected.map((id) => byId.get(id)).filter(Boolean);
    if (!chosen.length) {
      toast("Select at least one message");
      return;
    }
    setBusy(true);
    props.onTranslate(chosen);
  };
  const bottomPadding = useSheetBottomPadding();
  const { height } = RN.useWindowDimensions();
  const bodyHeight = Math.round(height * 0.78);
  return h(
    TranslationSheet,
    {
      bodyHeight,
      sheetKey: "dariuss-qt-bulk-select-" + props.request.nonce,
      title: "Bulk translate",
      onClose: props.onClose,
    },
    h(
      Design.Stack,
      { style: { height: bodyHeight, paddingBottom: bottomPadding }, spacing: 8 },
      h(Design.Text, { variant: "text-sm/normal" },
        selected.length + " selected · " + messages.length + " loaded · newest first",
      ),
      h(CustomInput, {
        value: query,
        placeholder: "Search messages",
        onChangeText: setQuery,
        autoCorrect: false,
        style: { marginBottom: 10 },
      }),
      h(
        RN.View,
        { style: { flexDirection: "row", marginBottom: 10 } },
        h(
          RN.View,
          { style: { flex: 1, marginRight: 6 } },
          h(CustomAction, {
            title: isAll ? "Deselect all" : "Select all",
            secondary: true,
            onPress: () =>
              setSelected((current) =>
                isAll
                  ? current.filter(
                      (id) => !visible.some((m) => String(m.id) === id),
                    )
                  : Array.from(
                      new Set(current.concat(visible.map((m) => String(m.id)))),
                    ),
              ),
          }),
        ),
        h(
          RN.View,
          { style: { flex: 1, marginLeft: 6 } },
          h(CustomAction, {
            title: "Clear selection",
            secondary: true,
            onPress: () => setSelected([]),
          }),
        ),
      ),
      visible.length
        ? h(
            BottomSheet.BottomSheetScrollView,
            {
              style: { flex: 1 },
              keyboardShouldPersistTaps: "handled",
              contentContainerStyle: { paddingBottom: 12 },
              onScroll: onListScroll,
              scrollEventThrottle: 180,
            },
            h(
              CustomSection,
              { title: "Messages" },
              ...visible.map((message) => {
                const id = String(message.id);
                const marked = selected.includes(id);
                const label = String(message.content)
                  .replace(/\s+/g, " ")
                  .trim();
                const author = nameOf(message.author);
                const translated = translations.get(id);
                return h(Design.TableCheckboxRow, {
                  key: id,
                  value: id,
                  checked: marked,
                  label: (id === seedId ? "Selected message · " : "") + author,
                  subLabel: translated?.text ? label + "\n→ " + translated.text : label,
                  subLabelLineClamp: 5,
                  onPress: () => toggle(message),
                });
              }),
            ),
            loadingMore
              ? h(
                  RN.View,
                  { style: { padding: 16, alignItems: "center" } },
                  h(RN.ActivityIndicator, { color: C.blurple }),
                  h(
                    Design.Text,
                    { style: { color: C.sub, fontSize: 12, marginTop: 8 } },
                    "Loading 30 messages…",
                  ),
                )
              : hasMore
                ? h(
                    Design.Text,
                    {
                      style: {
                        textAlign: "center",
                        color: C.sub,
                        fontSize: 12,
                        padding: 16,
                      },
                    },
                    loadError || "Scroll down to load 30 older messages",
                  )
                : h(
                    Design.Text,
                    {
                      style: {
                        textAlign: "center",
                        color: C.sub,
                        fontSize: 12,
                        padding: 16,
                      },
                    },
                    "End of available messages",
                  ),
          )
        : h(
            RN.View,
            {
              style: {
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              },
            },
            h(
              Design.Text,
              { style: { color: C.sub } },
              "No loaded messages match this search.",
            ),
          ),
      h(CustomAction, {
        title: busy
          ? "Opening translation…"
          : "Continue to translation · " + selected.length,
        disabled: busy || !selected.length,
        onPress: run,
      }),
    ),
  );
}
function refreshTranslated() {
  translations.forEach((t, id) => {
    if (t.ch) refreshRow(t.ch, id);
  });
}
function showOriginal(message) {
  const channelId =
    message.channel_id || message.channelId || currentChannelId();
  translations.delete(String(message.id));
  updateQuickTranslateSettings({
    messageTranslations: (qt.messageTranslations || []).filter(
      (entry) => String(entry.messageId) !== String(message.id),
    ),
  });
  refreshRow(channelId, message.id);
}
function paint(nodes, color) {
  if (!color) return nodes;
  return [
    {
      type: "link",
      // Discord 352.6 reads the color directly from LinkContentNode.
      // An actionless target styles this span without opening a user profile.
      target: { linkColor: color, medium: false },
      linkColor: color,
      content: nodes.filter((n) => n && INLINE.has(n.type)),
    },
  ];
}
function stripOurs(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n && n.__tr) continue;
    if (n && Array.isArray(n.content)) {
      const inner = stripOurs(n.content);
      if (!inner.length && n.content.length) continue;
      out.push(
        inner.length === n.content.length
          ? n
          : Object.assign({}, n, { content: inner }),
      );
    } else out.push(n);
  }
  return out;
}
function translatedNodes(value) {
  const nodes = [];
  const emoji = /<(a?):([\w~]+):(\d+)>/g;
  let last = 0;
  let match;
  while ((match = emoji.exec(value))) {
    if (match.index > last)
      nodes.push({
        type: "text",
        content: value.slice(last, match.index),
        __tr: true,
      });
    const id = match[3];
    const webp = `https://cdn.discordapp.com/emojis/${id}.webp?size=128`;
    nodes.push({
      type: "customEmoji",
      id,
      alt: match[2],
      src: match[1] ? webp.replace(".webp", ".gif") : webp,
      frozenSrc: webp,
    });
    last = match.index + match[0].length;
  }
  if (last < value.length || !nodes.length)
    nodes.push({ type: "text", content: value.slice(last), __tr: true });
  return nodes;
}
let markdownParserLookupDone = false;
let markdownParserModule = null;
function parseLanguageSubtext(label) {
  try {
    if (!markdownParserLookupDone) {
      markdownParserLookupDone = true;
      markdownParserModule =
        findByProps("parse", "unparse") || findByProps("parse");
    }
    const parse = markdownParserModule && markdownParserModule.parse;
    if (typeof parse === "function") {
      const nodes = parse.call(
        markdownParserModule,
        "-# " + String(label || ""),
      );
      const hasLiteralMarker = (node) => {
        if (typeof node === "string") return node.includes("-#");
        if (!node || typeof node !== "object") return false;
        return (
          (typeof node.content === "string" && node.content.includes("-#")) ||
          (Array.isArray(node.content) &&
            node.content.some(hasLiteralMarker)) ||
          (node.value &&
            typeof node.value === "object" &&
            hasLiteralMarker(node.value))
        );
      };
      // Only trust a real block-level subtext result. A generic parser can
      // return ordinary text here, which silently loses the -# styling.
      if (
        Array.isArray(nodes) &&
        nodes.length &&
        !nodes.some(hasLiteralMarker) &&
        nodes.some(
          (node) =>
            node &&
            typeof node === "object" &&
            (node.type === "subtext" || node.type === "small"),
        )
      )
        return nodes.map((node) =>
          node && typeof node === "object"
            ? { ...node, __tr: true }
            : { type: "text", content: String(node || ""), __tr: true },
        );
    }
  } catch (_) {}
  // Discord's message AST uses a block-level subtext node for the -# format.
  // This keeps the label small even when the internal parser module is hidden.
  return [
    {
      type: "subtext",
      content: [{ type: "text", content: String(label || ""), __tr: true }],
      __tr: true,
    },
  ];
}
function decorate(row, input) {
  // Voice transcripts and their translations share the block below the audio.
  if (
    globalThis.__valencedVoiceTranscriptBridge?.handlesInline?.(
      String(row?.message?.id),
    )
  )
    return;
  const m = row && row.message;
  if (!m) return;
  const rowType = row.type ?? input?.rowType ?? row.rowType;
  if (rowType !== 1) return;
  const tr = translations.get(String(m.id));
  const ours = m.__trOut && m.content === m.__trOut;
  if (!tr) {
    if (ours) {
      m.content = m.__trBaseRaw !== undefined ? m.__trBaseRaw : m.__trBase;
      delete m.__trBaseRaw;
      delete m.__trBase;
      delete m.__trOut;
    } else if (Array.isArray(m.content)) {
      const clean = stripOurs(m.content);
      if (clean.length !== m.content.length) m.content = clean;
    }
    return;
  }
  const originalContent = ours
    ? m.__trBaseRaw !== undefined
      ? m.__trBaseRaw
      : m.__trBase
    : m.content;
  const base = ours
    ? m.__trBase
    : Array.isArray(m.content)
      ? stripOurs(m.content)
      : m.content == null ||
          (typeof m.content === "string" && !m.content.trim())
        ? []
        : typeof m.content === "string"
          ? [{ type: "text", content: m.content }]
          : null;
  if (!Array.isArray(base)) return;
  const pc = RN.processColor;
  const color = pc ? pc(translationColor()) : null;
  const text = translatedNodes(tr.text);
  let out;
  const rawSource = String(tr.src || "").toLowerCase();
  const sourceCode =
    rawSource === "zh-cn"
      ? "zh-CN"
      : rawSource === "zh-tw"
        ? "zh-TW"
        : rawSource.split("-")[0];
  const sourceHint =
    qt.showSourceLanguage && sourceCode && sourceCode !== "auto"
      ? parseLanguageSubtext(
          langName(sourceCode) + " → " + langName(String(tr.tl || "")),
        )
      : [];
  const immersive = tr.autoIncoming
    ? qt.autoIncomingImmersive
    : (tr.immersive ?? qt.immersive);
  const lineBreak = () => ({ type: "text", content: "\n", __tr: true });
  if (immersive)
    out = base.concat([lineBreak()], sourceHint, paint(text, color));
  else out = sourceHint.concat(paint(text, color));
  if (!out.length) return;
  m.__trBaseRaw = originalContent;
  m.__trBase = base;
  m.__trOut = out;
  m.content = out;
}
function onRenderError() {
  renderErrors++;
  if (renderErrors >= 3 && renderUnpatch) {
    try {
      renderUnpatch();
    } catch (_) {
      /* ignore */
    }
    renderUnpatch = null;
    toast("Quick Translate: message styling disabled after repeated errors");
  }
}
function patchRender() {
  unpatches.push(
    observeName("RowManager", (RowManager) => {
      const target = RowManager?.prototype || RowManager?.default?.prototype;
      if (typeof target?.generate !== "function")
        throw new Error("Quick Translate: RowManager.generate is unavailable");
      renderUnpatch = after("generate", target, (args, row) => {
        if (!row?.message) return row;
        // Never mutate a cached message owned by Discord.
        const output = { ...row, message: { ...row.message } };
        try {
          decorate(output, args[0]);
          if ((row.type ?? args[0]?.rowType ?? row.rowType) === 1) {
            const id = String(row.message.id);
            const changed = pendingRowUpdates.delete(id);
            // Native Discord skips unchanged records unless the row is explicitly rebound.
            if (changed || translations.has(id)) output.changeType = 2;
          }
          return output;
        } catch (error) {
          onRenderError();
          reportIntegrationError(error);
          return row;
        }
      });
    }),
  );
}
/* ------------------------------------------------------------------ */
/* message long-press menu                                             */
/* ------------------------------------------------------------------ */
function messageContentText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  const parts = [];
  const visit = (node) => {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (typeof node.content === "string") parts.push(node.content);
    else if (Array.isArray(node.content)) node.content.forEach(visit);
    if (node.type === "customEmoji" && node.name)
      parts.push(":" + node.name + ":");
  };
  value.forEach(visit);
  return parts.join("");
}
function messagePlan(message) {
  if (!message || !message.id) return null;
  const transcript =
    globalThis.__valencedVoiceTranscriptBridge?.getTranscript?.(
      String(message.id),
    );
  const text =
    transcript || messageContentText(message.__trBase || message.content);
  if (!text.trim()) return null;
  const actionMessage =
    !transcript && typeof message.content === "string"
      ? message
      : { ...message, content: text };
  const plan = [];
  if (translations.has(String(message.id))) {
    plan.push({
      key: "qt-original",
      label: "Show original message",
      press: () => showOriginal(actionMessage),
    });
  } else {
    plan.push({
      key: "qt-translate",
      label: "Translate to " + langName(qt.targetIn),
      press: () =>
        translateMessage(
          actionMessage,
          qt.targetIn,
          false,
          undefined,
          false,
          "auto",
        ),
    });
  }
  const channelId = String(
    message.channel_id || message.channelId || currentChannelId() || "",
  );
  if (channelId)
    plan.push({
      key: "qt-select-messages",
      label: "Bulk translate…",
      press: () => openBulkSelection(actionMessage),
    });
  plan.push({
    key: "qt-translate-to",
    label: "Translate to...",
    press: () => openMessageTranslationPanel(actionMessage, qt.targetIn),
  });
  const translated = translations.get(String(message.id));
  if (translated?.text)
    plan.push({
      key: "qt-copy-translation",
      label: "Copy translation",
      press: () => copyText(translated.text),
    });
  return plan;
}
function openMessageTranslationPanel(message, target) {
  const text =
    typeof message?.content === "string"
      ? message.content
      : messageContentText(message?.content);
  if (!text.trim()) {
    toast("This message has no text to translate");
    return false;
  }
  pendingMessageRequest = {
    nonce: ++messageRequestNonce,
    message: { ...message, content: text },
    target: target || qt.targetIn || "en",
    source: "auto",
  };
  notifyButton();
  return true;
}
function openBulkTranslationPanel(messages, target) {
  const cleanMessages = (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const text =
        typeof message?.content === "string"
          ? message.content
          : messageContentText(message?.content);
      return text.trim() ? { ...message, content: text } : null;
    })
    .filter(Boolean);
  if (!cleanMessages.length) {
    toast("No selected messages contain translatable text");
    return false;
  }
  pendingMessageRequest = {
    nonce: ++messageRequestNonce,
    messages: cleanMessages,
    target: target || qt.targetIn || "en",
    source: "auto",
  };
  notifyButton();
  return true;
}
function installTextBridge() {
  const root = globalThis;
  const detections = new Map();
  async function detectLanguage(input, options = {}) {
    const text = String(input || "")
      .trim()
      .slice(0, 2000);
    if (!pluginStarted || options.signal?.aborted || !/[\p{L}]/u.test(text))
      return null;
    // Exact configured phrases can resolve short ambiguous transcripts without a request.
    const exact = text
      .toLocaleLowerCase()
      .replace(/[.!?]+$/, "")
      .trim();
    const rule = (
      Array.isArray(qt.wordLanguageRules) ? qt.wordLanguageRules : []
    ).find(
      (rule) =>
        rule?.word?.trim().toLocaleLowerCase() === exact &&
        rule.language !== "auto" &&
        LANG_NAME.has(rule.language),
    );
    if (rule) return { code: rule.language, name: langName(rule.language) };
    if (detections.has(text)) return detections.get(text);
    const generation = cacheGeneration;
    try {
      const detected = await enqueueRequest(async () => {
        if (!pluginStarted || options.signal?.aborted) return null;
        const response = await fetchWithTimeout(
          "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=ld&q=" +
            encodeURIComponent(text),
          { signal: options.signal },
        );
        if (!response.ok) return null;
        const json = await response.json();
        const code = typeof json?.[2] === "string" ? json[2] : "";
        if (
          !code ||
          code === "auto" ||
          !pluginStarted ||
          generation !== cacheGeneration ||
          options.signal?.aborted
        )
          return null;
        return { code, name: langName(code) };
      }, !!options.automatic);
      if (
        detected &&
        pluginStarted &&
        generation === cacheGeneration &&
        !options.signal?.aborted
      ) {
        detections.set(text, detected);
        while (detections.size > 100)
          detections.delete(detections.keys().next().value);
      }
      return detected;
    } catch {
      return null;
    }
  }
  const api = {
    detectLanguage,
    isActive: () => pluginStarted,
    getMessageActions: (message) => {
      if (!pluginStarted) return [];
      const plan = messagePlan(message);
      return plan
        ? plan.filter((item) => item.key !== "qt-select-messages")
        : [];
    },
    getMessageTranslation: (messageId) => {
      const result = translations.get(String(messageId));
      if (!result || !result.text) return null;
      const sourceCode = String(result.src || "").toLowerCase();
      const source =
        sourceCode === "zh-cn"
          ? "zh-CN"
          : sourceCode === "zh-tw"
            ? "zh-TW"
            : sourceCode.split("-")[0];
      const target = String(result.tl || "").toLowerCase();
      const sourceLabel =
        qt.showSourceLanguage && source && source !== "auto"
          ? langName(source) + " → " + langName(target)
          : "";
      return {
        text: result.text,
        color: translationColor(),
        immersive: result.autoIncoming
          ? qt.autoIncomingImmersive
          : (result.immersive ?? qt.immersive),
        sourceLabel,
      };
    },
  };
  pluginStarted = true;
  root["__valencedQuickTranslateTextBridge"] = api;
  unpatches.push(() => {
    pluginStarted = false;
    detections.clear();
    if (root["__valencedQuickTranslateTextBridge"] === api)
      delete root["__valencedQuickTranslateTextBridge"];
  });
}
function patchActionSheet() {
  installMessageMenu(messagePlan);
}
/* ------------------------------------------------------------------ */
/* chat bar button                                                     */
/* ------------------------------------------------------------------ */
function quickLanguages(settings) {
  return Array.isArray(settings.favLangs)
    ? [...new Set(settings.favLangs)].filter((code) => LANG_NAME.has(code)).slice(0, MAX_FAVS)
    : [];
}
function TranslateButton(props) {
  const h = React.createElement;
  const settings = useQuickTranslate();
  const [busy, setBusy] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [panelPage, setPanelPage] = React.useState("main");
  const [measuredPanelHeight, setMeasuredPanelHeight] = React.useState(0);
  const bottomPadding = useSheetBottomPadding();
  const { height: windowHeight } = RN.useWindowDimensions();
  const [source, setSource] = React.useState(
    getChatLanguages().sourceOut || "auto",
  );
  const [target, setTarget] = React.useState(
    getChatLanguages().targetOut || "en",
  );
  const [query, setQuery] = React.useState("");
  const [messageRequest, setMessageRequest] = React.useState(null);
  const seenMessageRequest = React.useRef(0);
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const f = () => {
      tick((x) => x + 1);
      const request = pendingMessageRequest;
      const anchor = useQuickTranslate.getState()?.anchor;
      const panelHostPosition = anchor === "send" ? "send" : "actions";
      if (
        props.position !== panelHostPosition ||
        !request ||
        request.nonce === seenMessageRequest.current
      )
        return;
      seenMessageRequest.current = request.nonce;
      setMessageRequest(request);
      setSource(request.source || "auto");
      setTarget(request.target || qt.targetIn || "en");
      setQuery("");
      setPanelPage("main");
      setPanelOpen(true);
    };
    buttonListeners.add(f);
    return () => {
      buttonListeners.delete(f);
    };
  }, []);
  if (!pluginStarted) return null;
  if (settings.showButton === false && !messageRequest) return null;
  if (props.position === "actions" && settings.anchor !== "actions")
    return null;
  if (
    props.position === "send" &&
    settings.anchor !== "send" &&
    !(armed && settings.draftBeforeSend !== false)
  )
    return null;
  const run = (tl, sl) => {
    if (busy) return Promise.resolve(false);
    setBusy(true);
    let p;
    try {
      p = translateCurrentText(tl, sl);
    } catch (_) {
      p = Promise.resolve(false);
    }
    return p.then(
      (ok) => {
        setBusy(false);
        return ok;
      },
      () => {
        setBusy(false);
        return false;
      },
    );
  };
  const iconId = findAssetId("LanguageIcon") || findAssetId("GlobeIcon");
  const translateSendMode =
    props.position === "send" && !!armed && settings.draftBeforeSend !== false;
  const highlightedTranslate =
    translateSendMode && settings.highlightDraftButton !== false;
  const onPress = () => {
    if (
      armed &&
      props.position === "send" &&
      settings.draftBeforeSend !== false
    ) {
      const job = armed;
      run(job.tl, job.sl).then((ok) => {
        if (ok) {
          armed = job.oneShot ? job.resume || null : null;
          notifyButton();
        }
      });
      return;
    }
    if (armed) {
      armed = null;
      notifyButton();
      toast("Translation turned off");
      return;
    }
    const preferences = getChatLanguages();
    armed = {
      tl: preferences.targetOut || "en",
      sl: preferences.sourceOut || "auto",
    };
    notifyButton();
    toast(
      settings.keepArmed
        ? "Translation is active until you turn it off"
        : "Translation will apply to your next message",
    );
  };
  const openPanel = () => {
    const preferences = getChatLanguages();
    setSource(preferences.sourceOut || "auto");
    setTarget(preferences.targetOut || "en");
    setQuery("");
    setPanelPage("main");
    setPanelOpen(true);
  };
  const closePanel = () => {
    setPanelOpen(false);
    setPanelPage("main");
    setQuery("");
    if (messageRequest && pendingMessageRequest?.nonce === messageRequest.nonce)
      pendingMessageRequest = null;
    setMessageRequest(null);
  };
  const favorites = quickLanguages(settings);
  const paletteNow = palette();
  const sourceLanguages = [["auto", "Auto-detect"], ...LANGS];
  const selectTargetLanguage = (code) => {
    setTarget(code);
  };
  const confirmTargetLanguage = () => {
    setPanelPage("main");
    setQuery("");
  };
  const activateOnce = () => {
    if (messageRequest) {
      setBusy(true);
      const selectedMessages = Array.isArray(messageRequest.messages)
        ? messageRequest.messages
        : [messageRequest.message].filter(Boolean);
      if (selectedMessages.length > 1) {
        (async () => {
          let translatedCount = 0;
          let alreadyCount = 0;
          let failedCount = 0;
          const serviceCounts = { deepl: 0, google: 0 };
          for (const item of selectedMessages) {
            const id = String(item?.id || "");
            const previous = translations.get(id);
            const ok = await translateMessage(
              item,
              target,
              true,
              undefined,
              false,
              source,
            );
            const current = translations.get(id);
            if (!ok) failedCount++;
            else if (current && current !== previous) {
              translatedCount++;
              serviceCounts[
                current.provider === "deepl" ? "deepl" : "google"
              ]++;
            } else alreadyCount++;
          }
          setBusy(false);
          const services = [];
          if (String(qt.deeplApiKey || "").trim() && serviceCounts.google)
            services.push(serviceCounts.google + " Google Translate");
          if (String(qt.deeplApiKey || "").trim() && serviceCounts.deepl)
            services.push(serviceCounts.deepl + " DeepL");
          toast(
            translatedCount +
              " translated" +
              (services.length ? " · " + services.join(" · ") : "") +
              " · " +
              alreadyCount +
              " already in " +
              langName(target) +
              " · " +
              failedCount +
              " failed",
          );
          closePanel();
        })();
        return;
      }
      const item = selectedMessages[0];
      const messageId = String(item?.id || "");
      const previousTranslationAt = translations.get(messageId)?.at;
      translateMessage(item, target, false, undefined, false, source).then(
        (ok) => {
          setBusy(false);
          const result = translations.get(messageId);
          const translatedText = String(result?.text || "").trim();
          const originalText = String(item?.content || "").trim();
          if (
            ok &&
            result &&
            result.at !== previousTranslationAt &&
            translatedText &&
            translatedText !== originalText
          )
            closePanel();
        },
      );
      return;
    }
    const resume = armed?.oneShot ? armed.resume || null : armed;
    armed = { tl: target, sl: source, oneShot: true, resume };
    notifyButton();
    closePanel();
    toast(
      "Translate once is ready. Translate the draft to " +
        langName(target) +
        "; your usual language will return after.",
    );
  };
  const setPermanentLanguage = () => {
    const channelId = currentChannelId();
    saveChatLanguages(channelId, { targetOut: target });
    if (armed?.oneShot)
      armed = { ...armed, resume: { tl: target, sl: source } };
    else if (armed) armed = { tl: target, sl: source };
    notifyButton();
    closePanel();
    toast(langName(target) + " is now the usual language for this chat");
  };
  const languageOptions = (
    panelPage === "source" ? sourceLanguages : LANGS
  ).filter(
    ([code, name]) =>
      !query.trim() ||
      name.toLowerCase().includes(query.trim().toLowerCase()) ||
      code.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const panelBody =
    panelPage === "main"
      ? [
          h(
            Design.Text,
            {
              key: "hint",
              style: { color: paletteNow.sub, fontSize: 14, marginBottom: 16 },
            },
            messageRequest
              ? messageRequest.messages?.length > 1
                ? "Choose languages, then translate " +
                  messageRequest.messages.length +
                  " selected messages once."
                : "Choose languages, then translate this message once."
              : "Translate this draft once. Your chat’s default language stays unchanged.",
          ),
          h(
            CustomSection,
            { key: "languages", title: "Languages", compact: true },
            h(CustomRow, {
              title: "Translate from",
              subtitle: languageLabel(source),
              icon: "↗",
              onPress: () => {
                setQuery("");
                setPanelPage("source");
              },
              trailing: h(
                Design.Text,
                { style: { color: paletteNow.sub, fontSize: 20 } },
                "›",
              ),
            }),
            h(CustomRow, {
              title: "Translate to",
              subtitle: languageLabel(target),
              icon: "↙",
              last: true,
              onPress: () => {
                setQuery("");
                setPanelPage("target");
              },
              trailing: h(
                Design.Text,
                { style: { color: paletteNow.sub, fontSize: 20 } },
                "›",
              ),
            }),
          ),
          favorites.length
            ? h(
                Design.Stack,
                { key: "favorites", spacing: 6, style: { marginTop: 10, marginBottom: 6 } },
                h(Design.Text, { variant: "text-sm/medium", color: "text-muted" }, "Quick languages"),
                h(
                  RN.View,
                  { style: { flexDirection: "row", gap: 6 } },
                  ...favorites.map((code) => h(Design.Button, {
                    key: code,
                    text: code.toUpperCase(),
                    size: "sm",
                    variant: code === target ? "primary" : "secondary",
                    accessibilityLabel: langName(code),
                    accessibilityState: { selected: code === target },
                    style: { flex: 1, minWidth: 0 },
                    onPress: () => selectTargetLanguage(code),
                  })),
                ),
              )
            : null,
        ]
      : [
          h(CustomAction, {
            key: "back",
            title: "‹  Back",
            secondary: true,
            onPress: () => {
              setPanelPage("main");
              setQuery("");
            },
          }),
          h(CustomInput, {
            key: "search",
            style: { marginVertical: 12 },
            value: query,
            placeholder: "Search language",
            onChangeText: setQuery,
            autoCorrect: false,
          }),
          h(
            CustomSection,
            {
              key: "list",
              title:
                panelPage === "source" ? "Translate from" : "Translate to",
            },
            ...languageOptions.map(([code, label], index) =>
              h(CustomRow, {
                key: code,
                title: languageLabel(code, label),
                subtitle: code,
                trailing:
                  (panelPage === "source" ? source : target) === code
                    ? h(
                        Design.Text,
                        {
                          style: {
                            color: paletteNow.blurple,
                            fontWeight: "700",
                          },
                        },
                        "✓",
                      )
                    : null,
                last: index === languageOptions.length - 1,
                onPress: () => {
                  if (panelPage === "source") {
                    setSource(code);
                    saveChatLanguages(currentChannelId(), {
                      sourceOut: code,
                    });
                  } else {
                    selectTargetLanguage(code);
                    return;
                  }
                  setPanelPage("main");
                  setQuery("");
                },
              }),
            ),
          ),
        ];
  const isMainPanel = panelPage === "main";
  const panelHeight = Math.min(Math.round(windowHeight * 0.81),
    isMainPanel ? measuredPanelHeight || 390 : Math.round(windowHeight * 0.68));
  const footer = isMainPanel
    ? h(Design.Stack, { spacing: 6, style: { paddingTop: 2 } },
        h(Design.Button, {
          text: busy ? "Translating…" : (messageRequest ? "Translate once" : "Activate once") + " · " + langName(target),
          size: "sm",
          disabled: busy,
          onPress: activateOnce,
        }),
        !messageRequest && h(Design.Button, {
          text: "Set " + langName(target) + " as usual",
          size: "sm",
          variant: "secondary",
          onPress: setPermanentLanguage,
        }),
        !messageRequest && lastOriginal != null && h(Design.Button, {
          text: "Restore original text",
          size: "sm",
          variant: "secondary",
          onPress: () => { closePanel(); restoreOriginal(); },
        }),
        !messageRequest && armed && h(Design.Button, {
          text: "Turn off Translate",
          size: "sm",
          variant: "secondary",
          onPress: () => { armed = null; notifyButton(); closePanel(); },
        }),
      )
    : panelPage === "target"
      ? h(Design.Button, {
          text: "Confirm " + langName(target),
          size: "sm",
          onPress: confirmTargetLanguage,
        })
      : null;
  return h(
    React.Fragment,
    null,
    h(NativeIconControl, {
      icon: iconId,
      fallback: "文",
      variant: highlightedTranslate ? "primary" : "tertiary",
      iconColor: props.position === "actions"
        ? armed ? ACCENT : paletteNow.text
        : highlightedTranslate ? undefined : paletteNow.text,
      label: translateSendMode ? "Translate draft" : "Translate message",
      holdLabel: "Open translation options",
      disabled: busy,
      onPress,
      onLongPress: openPanel,
    }),
    panelOpen
      ? h(
          TranslationSheet,
          {
            sheetKey: "dariuss-qt-translate-" + props.position,
            title: messageRequest
              ? messageRequest.messages?.length > 1 ? "Translate messages" : "Translate message"
              : "Translate draft",
            onClose: closePanel,
            bodyHeight: panelHeight,
          },
          h(
            RN.View,
            { style: { height: panelHeight, paddingBottom: isMainPanel ? 0 : bottomPadding } },
            h(
              BottomSheet.BottomSheetScrollView,
              {
                key: isMainPanel ? "main" : "languages",
                keyboardShouldPersistTaps: "handled",
                style: { flex: 1 },
                contentContainerStyle: isMainPanel ? { paddingBottom: bottomPadding } : undefined,
                onContentSizeChange: isMainPanel
                  ? (_width, measured) => { if (measured > 0) setMeasuredPanelHeight(Math.ceil(measured)); }
                  : undefined,
              },
              ...panelBody,
              isMainPanel ? footer : null,
            ),
            isMainPanel ? null : footer,
          ),
        )
      : null,
    bulkSelectionRequest && props.position === settings.anchor
      ? h(BulkMessageSelector, {
          key: bulkSelectionRequest.nonce,
          request: bulkSelectionRequest,
          onClose: () => {
            bulkSelectionRequest = null;
            notifyButton();
          },
          onTranslate: (messages) => {
            bulkSelectionRequest = null;
            openBulkTranslationPanel(messages, qt.targetIn || "en");
          },
        })
      : null,
  );
}
function patchChatButton() {
  const h = React.createElement;
  const installed = new WeakSet();
  const hideGift = (component) => {
    if (!component?.type || installed.has(component.type)) return;
    installed.add(component.type);
    unpatches.push(
      before("render", component.type, ([props]) => {
        if (props && qt.hideGiftButton) props.shouldShowGiftButton = false;
      }),
    );
  };
  unpatches.push(
    observeComponent("ChatInputActions", (component) => {
      hideGift(component);
      unpatches.push(
        after("render", component.type, (_, ret) => {
          if (!ret) return ret;
          return h(ComposerActionsSlot, { children: ret });
        }),
      );
    }),
  );
  unpatches.push(observeComponent("ChatInputRightActions", hideGift));
  unpatches.push(
    observeComponent("ChatInputSendButton", (component) => {
      unpatches.push(
        after("render", component.type, (_, ret) => {
          if (!ret) return ret;
          return h(ComposerSendSlot, {
            button: h(TranslateButton, {
              key: "qt-button-send",
              position: "send",
            }),
            children: ret,
          });
        }),
      );
    }),
  );
}
function ComposerActionsSlot(props) {
  const h = React.createElement;
  const settings = useQuickTranslate();
  if (settings.anchor === "send" || settings.showButton === false)
    return props.children;
  return h(
    RN.View,
    {
      pointerEvents: "box-none",
      collapsable: false,
      style: {
        flexDirection: "row",
        alignItems: "center",
        overflow: "visible",
      },
    },
    props.children,
    h(TranslateButton, { position: "actions" }),
  );
}
function ComposerSendSlot(props) {
  const h = React.createElement;
  const settings = useQuickTranslate();
  const [active, setActive] = React.useState(!!armed);
  React.useEffect(() => {
    const refresh = () => setActive(!!armed);
    buttonListeners.add(refresh);
    return () => {
      buttonListeners.delete(refresh);
    };
  }, []);
  const replaceSend =
    active &&
    settings.showButton !== false &&
    settings.draftBeforeSend !== false;
  const showTranslate =
    settings.showButton !== false &&
    (settings.anchor === "send" || replaceSend);
  if (!showTranslate) return props.children;
  if (replaceSend)
    return h(
      RN.View,
      {
        pointerEvents: "box-none",
        collapsable: false,
        style: {
          position: "relative",
          alignItems: "center",
          justifyContent: "center",
          alignSelf: "center",
        },
      },
      h(
        RN.View,
        {
          pointerEvents: "none",
          accessible: false,
          accessibilityElementsHidden: true,
          importantForAccessibility: "no-hide-descendants",
          style: { opacity: 0 },
        },
        props.children,
      ),
      h(
        RN.View,
        {
          pointerEvents: "box-none",
          style: {
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            alignItems: "center",
            justifyContent: "center",
          },
        },
        props.button,
      ),
    );
  return h(
    RN.View,
    {
      pointerEvents: "box-none",
      style: {
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "center",
        flexGrow: 0,
        flexShrink: 0,
      },
    },
    props.button,
    props.children,
  );
}
function WordLanguageRulesPage() {
  const h = React.createElement,
    settings = useQuickTranslate(),
    navigation = NavigationNative.useNavigation(),
    C = palette();
  const [word, setWord] = React.useState("");
  const [language, setLanguage] = React.useState("");
  const [editing, setEditing] = React.useState(null);
  const rules = Array.isArray(settings.wordLanguageRules)
    ? settings.wordLanguageRules
    : [];
  const save = () => {
    const value = word.trim();
    if (!value || !LANG_NAME.has(language)) return;
    const key = value.toLocaleLowerCase();
    const next = rules.filter(
      (rule) =>
        rule.word.toLocaleLowerCase() !== key &&
        rule.word.toLocaleLowerCase() !== editing,
    );
    if (next.length >= 100) {
      toast("You can save up to 100 word language rules");
      return;
    }
    updateQuickTranslateSettings({
      wordLanguageRules: [...next, { word: value, language }],
    });
    setWord("");
    setLanguage("");
    setEditing(null);
  };
  return h(
    RN.ScrollView,
    {
      style: { flex: 1 },
      keyboardShouldPersistTaps: "handled",
      contentContainerStyle: settingsContent,
    },
    h(
      CustomSection,
      { title: editing ? "Edit rule" : "Add rule" },
      h(
        RN.View,
        { style: { padding: 14 } },
        h(
          Design.Text,
          {
            style: {
              color: C.sub,
              fontSize: 13,
              lineHeight: 18,
              marginBottom: 12,
            },
          },
          "Choose a source language for a word or phrase. Only matching words are overridden, even inside a sentence. Explicit source languages and protected words take priority.",
        ),
        h(CustomInput, {
          value: word,
          placeholder: "Word or phrase, e.g. Hello",
          maxLength: 80,
          autoCorrect: false,
          autoCapitalize: "none",
          onChangeText: setWord,
        }),
      ),
      h(CustomRow, {
        title: "Source language",
        subtitle: language ? languageLabel(language) : "Select a language",
        icon: "lang",
        last: true,
        onPress: () =>
          navigation.push("DariussQuickTranslatePage", {
            title: "Word language",
            render: () =>
              h(LangPicker, { value: language, onSelect: setLanguage }),
          }),
      }),
      h(CustomAction, {
        title: editing ? "Save rule" : "Add rule",
        disabled: !word.trim() || !LANG_NAME.has(language),
        onPress: save,
      }),
    ),
    h(
      CustomSection,
      {
        title: "Saved rules",
        footer:
          "Case-insensitive, whole-word matching. Rules apply only in Auto-detect mode.",
      },
      ...rules.map((rule, index) =>
        h(CustomRow, {
          key: rule.word.toLocaleLowerCase(),
          title: rule.word,
          subtitle: languageLabel(rule.language),
          icon: "lang",
          last: index === rules.length - 1,
          onPress: () => {
            setWord(rule.word);
            setLanguage(rule.language);
            setEditing(rule.word.toLocaleLowerCase());
          },
          trailing: h(CustomAction, {
            title: "Remove",
            compact: true,
            danger: true,
            secondary: true,
            top: 0,
            onPress: () => {
              updateQuickTranslateSettings({
                wordLanguageRules: rules.filter((_, i) => i !== index),
              });
              if (editing === rule.word.toLocaleLowerCase()) {
                setEditing(null);
                setWord("");
                setLanguage("");
              }
            },
          }),
        }),
      ),
      rules.length
        ? null
        : h(
            Design.Text,
            { style: { color: C.sub, padding: 16, fontSize: 14 } },
            "No rules yet. For example, add Hello and choose its source language.",
          ),
    ),
  );
}

function LangPicker(props) {
  const h = React.createElement;
  const settings = useQuickTranslate();
  const navigation = NavigationNative.useNavigation();
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const base =
    props.field === "sourceOut" ? [["auto", "Auto-detect"], ...LANGS] : LANGS;
  const list = base.filter(
    ([code, name]) =>
      !q || name.toLowerCase().includes(q) || code.toLowerCase().includes(q),
  );
  const choose = (code) => {
    if (typeof props.onSelect === "function") props.onSelect(code);
    else updateQuickTranslateSettings({ [props.field]: code });
    navigation.goBack();
  };
  return h(
    RN.ScrollView,
    {
      style: { flex: 1 },
      keyboardShouldPersistTaps: "handled",
      contentContainerStyle: { padding: 16, paddingBottom: 40 },
    },
    h(CustomInput, {
      value: query,
      placeholder: "Search language",
      onChangeText: setQuery,
      autoCorrect: false,
      style: { marginBottom: 18 },
    }),
    h(
      CustomSection,
      { title: "Languages" },
      ...list.map(([code, label], index) =>
        h(CustomRow, {
          key: code,
          title: languageLabel(code, label),
          subtitle: code,
          last: index === list.length - 1,
          trailing:
            (props.value ?? settings[props.field]) === code
              ? h(
                  Design.Text,
                  {
                    style: {
                      color: palette().blurple,
                      fontWeight: "700",
                      fontSize: 18,
                    },
                  },
                  "✓",
                )
              : null,
          onPress: () => choose(code),
        }),
      ),
    ),
  );
}
function FavPicker() {
  const h = React.createElement;
  const settings = useQuickTranslate();
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const favs = quickLanguages(settings);
  const list = LANGS.filter(
    ([c, n]) =>
      !q || n.toLowerCase().includes(q) || c.toLowerCase().includes(q),
  );
  return h(
    RN.ScrollView,
    {
      style: { flex: 1 },
      keyboardShouldPersistTaps: "handled",
      contentContainerStyle: { padding: 16, paddingBottom: 40 },
    },
    h(CustomInput, {
      value: query,
      placeholder: "Search language",
      onChangeText: setQuery,
      autoCorrect: false,
      style: { marginBottom: 18 },
    }),
    h(
      Design.Text,
      { style: { color: palette().sub, marginBottom: 12, fontSize: 14 } },
      favs.length + " of " + MAX_FAVS + " quick languages selected",
    ),
    h(
      CustomSection,
      { title: "Choose quick languages" },
      ...list.map(([code, label]) => {
        const on = favs.includes(code);
        return h(Design.TableCheckboxRow, {
          key: code,
          value: code,
          label: languageLabel(code, label),
          subLabel: code,
          checked: on,
          onPress: () => {
            if (on)
              updateQuickTranslateSettings({
                favLangs: favs.filter((x) => x !== code),
              });
            else if (favs.length < MAX_FAVS)
              updateQuickTranslateSettings({ favLangs: favs.concat([code]) });
            else toast("You can pick up to " + MAX_FAVS);
          },
        });
      }),
    ),
  );
}
function ColorPicker() {
  const h = React.createElement;
  const navigation = NavigationNative.useNavigation();
  const colors = palette();
  const current = translationColor();
  const select = (hex) => {
    updateQuickTranslateSettings({ translationColor: hex });
    refreshTranslated();
    navigation.goBack();
  };
  return h(
    RN.ScrollView,
    {
      style: { flex: 1 },
      contentContainerStyle: { padding: 16, paddingBottom: 40 },
    },
    h(
      Design.Text,
      {
        style: {
          color: colors.text,
          fontSize: 20,
          fontWeight: "700",
          marginBottom: 6,
        },
      },
      "Translation color",
    ),
    h(
      Design.Text,
      { style: { color: colors.sub, fontSize: 14, marginBottom: 8 } },
      "Choose a color preset. Your choice saves automatically.",
    ),
    h(
      CustomSection,
      { title: "Color presets" },
      ...COLOR_PRESETS.map(([label, hex], index) =>
        h(CustomRow, {
          key: hex,
          title: label,
          last: index === COLOR_PRESETS.length - 1,
          trailing: h(
            RN.View,
            {
              style: {
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginRight: 6,
              },
            },
            h(RN.View, {
              style: {
                width: 20,
                height: 20,
                borderRadius: 10,
                backgroundColor: hex,
              },
            }),
            current === hex
              ? h(
                  Design.Text,
                  {
                    style: {
                      color: colors.blurple,
                      fontWeight: "800",
                      width: 18,
                      textAlign: "center",
                    },
                  },
                  "✓",
                )
              : h(RN.View, { style: { width: 18 } }),
          ),
          onPress: () => select(hex),
        }),
      ),
    ),
    h(CustomAction, {
      title: "Use default",
      secondary: true,
      onPress: () => select(ACCENT),
    }),
  );
}
function historyChannelLabel(entry) {
  if (entry.channelName) return entry.channelName;
  const channel = getChannel(entry.channelId || null);
  if (!channel)
    return entry.channelId ? "Unavailable channel" : "Draft (not sent)";
  if (isDM(channel)) {
    const recipients = Array.isArray(channel.recipients)
      ? channel.recipients
      : [];
    const names = recipients.map((id) =>
      nameOf(safe(() => UserStore.getUser(String(id)), null)),
    );
    return channel.name || names.join(", ") || "Direct message";
  }
  const guildId = channel.guild_id || channel.guildId;
  const guildStore = safe(() => findByStoreName("GuildStore"), null);
  const guild = guildId
    ? safe(() => guildStore?.getGuild?.(String(guildId)), null)
    : null;
  return (
    (channel.name ? "# " + channel.name : "Channel") +
    (guild?.name ? " · " + guild.name : "")
  );
}
function deleteHistoryEntry(id) {
  const deleted = historyEntries.find((entry) => entry.id === id);
  if (deleted?.messageId) {
    translations.delete(String(deleted.messageId));
    if (deleted.channelId)
      refreshRow(deleted.channelId, String(deleted.messageId));
  }
  historyEntries = historyEntries.filter((entry) => entry.id !== id);
  const state = useQuickTranslate.getState();
  const messageTranslations = deleted?.messageId
    ? (state.messageTranslations || []).filter(
        (entry) =>
          !(
            entry.messageId === String(deleted.messageId) &&
            entry.channelId === String(deleted.channelId)
          ),
      )
    : state.messageTranslations || [];
  state.updateSettings({ historyEntries, messageTranslations });
  persistLocalData();
}
function dismissHistoryNavigation(navigation) {
  let current = navigation;
  let depth = 0;
  while (current && depth++ < 8) {
    try {
      if (current.canGoBack?.()) {
        if (typeof current.popToTop === "function") current.popToTop();
        else current.goBack?.();
      }
      current = current.getParent?.();
    } catch (_) {
      break;
    }
  }
}
function jumpToHistoryEntry(entry, navigation) {
  if (!entry.channelId || !entry.messageId) {
    toast("This translation is not linked to a Discord message");
    return;
  }
  const jump = safe(() => findByProps("jumpToMessage"), null);
  const navigate = safe(() => findByProps("transitionToChannel"), null);
  const performJump = () => {
    try {
      if (typeof jump?.jumpToMessage !== "function")
        throw new Error("message navigation is unavailable");
      jump.jumpToMessage({
        channelId: entry.channelId,
        messageId: entry.messageId,
        flash: true,
        jumpType: "ANIMATED",
      });
    } catch (_) {
      toast("Could not jump to this message");
    }
  };
  try {
    if (typeof navigate?.transitionToChannel !== "function")
      throw new Error("channel navigation is unavailable");
    dismissHistoryNavigation(navigation);
    navigate.transitionToChannel(entry.channelId, {});
    setTimeout(performJump, 650);
  } catch (_) {
    toast("Could not open this channel");
  }
}
function HistoryPage() {
  const h = React.createElement;
  const settings = useQuickTranslate();
  const navigation = NavigationNative.useNavigation();
  const [query, setQuery] = React.useState("");
  const [retryingId, setRetryingId] = React.useState(null);
  const allRows = Array.isArray(settings.historyEntries)
    ? settings.historyEntries
    : [];
  const needle = query.trim().toLowerCase();
  const rows = allRows.filter(
    (entry) =>
      !needle ||
      [
        entry.original,
        entry.translated,
        historyChannelLabel(entry),
        languageLabel(entry.source),
        languageLabel(entry.target),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
  );
  const retryWithAlternate = async (entry) => {
    if (retryingId) return;
    const provider = entry.provider === "deepl" ? "google" : "deepl";
    setRetryingId(entry.id);
    try {
      const { out, tokens } = protect(String(entry.original || ""));
      const result = await enqueueRequest(() =>
        callApi(provider, out, entry.target, entry.source || "auto"),
      );
      const translated = restore(result.text, tokens, false);
      const updated = {
        ...entry,
        alternativeTranslated: translated,
        alternativeProvider: provider,
        alternativeAt: Date.now(),
      };
      historyEntries = historyEntries.map((item) =>
        item.id === entry.id ? updated : item,
      );
      updateQuickTranslateSettings({
        historyEntries: historyEntries.slice(0, MAX_HISTORY),
      });
      persistLocalData();
    } catch (error) {
      toast(
        error?.message ||
          "Could not retranslate with " +
            (provider === "deepl" ? "DeepL" : "Google"),
      );
    } finally {
      setRetryingId(null);
    }
  };
  const cards = rows.map((entry, index) => {
    const alternateProvider = entry.provider === "deepl" ? "Google" : "DeepL";
    return h(
      CustomSection,
      {
        key: entry.id + index,
        title:
          languageLabel(entry.source) + " → " + languageLabel(entry.target),
      },
      h(
        RN.View,
        { style: { padding: 14 } },
        h(
          Design.Text,
          {
            numberOfLines: 1,
            style: { color: palette().sub, fontSize: 12, marginBottom: 7 },
          },
          historyChannelLabel(entry) + (entry.messageId ? "" : " · Draft"),
        ),
        h(
          Design.Text,
          {
            numberOfLines: 3,
            style: { color: palette().sub, fontSize: 13, marginBottom: 7 },
          },
          entry.original,
        ),
        h(
          Design.Text,
          {
            style: {
              color: palette().text,
              fontSize: 15,
              fontWeight: "600",
              lineHeight: 21,
            },
          },
          entry.translated,
        ),
        h(
          Design.Text,
          { style: { color: palette().sub, fontSize: 11, marginTop: 6 } },
          (entry.provider === "deepl" ? "DeepL" : "Google") +
            " · " +
            new Date(entry.at).toLocaleString(),
        ),
        entry.alternativeTranslated
          ? h(
              RN.View,
              {
                style: {
                  marginTop: 12,
                  padding: 11,
                  borderRadius: 11,
                  backgroundColor: palette().bg,
                  borderWidth: 1,
                  borderColor: palette().card2,
                },
              },
              h(
                Design.Text,
                {
                  style: {
                    color: palette().blurple,
                    fontSize: 12,
                    fontWeight: "700",
                    marginBottom: 5,
                  },
                },
                "Alternative · " +
                  (entry.alternativeProvider === "deepl" ? "DeepL" : "Google"),
              ),
              h(
                Design.Text,
                {
                  style: {
                    color: palette().text,
                    fontSize: 15,
                    lineHeight: 21,
                  },
                },
                entry.alternativeTranslated,
              ),
            )
          : null,
        h(CustomAction, {
          title:
            retryingId === entry.id
              ? "Translating…"
              : "Try " + alternateProvider,
          secondary: true,
          disabled: !!retryingId,
          onPress: () => retryWithAlternate(entry),
        }),
        h(
          RN.View,
          { style: { flexDirection: "row", marginTop: 2 } },
          h(
            RN.View,
            { style: { flex: 1, marginRight: 5 } },
            h(CustomAction, {
              title: "Delete",
              secondary: true,
              onPress: () => deleteHistoryEntry(entry.id),
            }),
          ),
          h(
            RN.View,
            { style: { flex: 1, marginLeft: 5 } },
            h(CustomAction, {
              title: "Jump to message",
              secondary: true,
              disabled: !entry.channelId || !entry.messageId,
              onPress: () => jumpToHistoryEntry(entry, navigation),
            }),
          ),
        ),
        h(CustomAction, {
          title: "Copy translation",
          secondary: true,
          onPress: () => copyText(entry.translated),
        }),
      ),
    );
  });
  return h(
    RN.ScrollView,
    {
      style: { flex: 1 },
      contentContainerStyle: settingsContent,
    },
    h(
      RN.View,
      { style: { flexDirection: "row", marginBottom: 12 } },
      h(
        RN.View,
        { style: { flex: 1 } },
        h(
          Design.Text,
          { style: { color: palette().text, fontSize: 22, fontWeight: "800" } },
          "Translation history",
        ),
        h(
          Design.Text,
          { style: { color: palette().sub, fontSize: 13, marginTop: 3 } },
          rows.length + " shown · " + allRows.length + " saved locally",
        ),
      ),
      h(
        Design.Text,
        { style: { color: palette().sub, fontSize: 19, marginTop: 2 } },
        "◷",
      ),
    ),
    h(CustomInput, {
      value: query,
      placeholder: "Search translations, channels, or languages",
      onChangeText: setQuery,
      autoCorrect: false,
      style: { marginBottom: 14 },
    }),
    rows.length
      ? null
      : h(
          Design.Text,
          {
            style: {
              color: palette().sub,
              fontSize: 14,
              paddingVertical: 20,
              textAlign: "center",
            },
          },
          allRows.length
            ? "No history entries match this search."
            : "No translations saved yet.",
        ),
    ...cards,
  );
}
function listChannelsForGuild(guild) {
  const channels = [];
  const seen = new Set();
  const channelStore = ChannelStore;
  const add = (item) => {
    if (
      !item ||
      typeof item !== "object" ||
      item.id == null ||
      item.name == null
    )
      return;
    const canonical =
      safe(() => channelStore.getChannel(String(item.id)), null) || item;
    const kind = canonical.type;
    if (kind != null && ![0, 5, 10, 11, 12, 15, 16].includes(kind)) return;
    if (!canonical.guild_id && !canonical.guildId && !guild?.id) return;
    const id = String(canonical.id);
    if (seen.has(id)) return;
    seen.add(id);
    channels.push({
      ...canonical,
      id,
      guildId: String(guild.id),
      guildName: guild.name || "Server",
    });
  };
  const visit = (value, depth) => {
    if (!value || depth > 6) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    add(value);
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") visit(child, depth + 1);
    }
  };
  for (const method of [
    "getMutableGuildChannelsForGuild",
    "getGuildChannels",
    "getChannels",
    "getSortedChannels",
  ]) {
    if (typeof channelStore?.[method] !== "function") continue;
    visit(
      safe(() => channelStore[method](String(guild.id)), null),
      0,
    );
  }
  visit(guild.channels, 0);
  return channels;
}
function AutoChannelsPage() {
  const h = React.createElement;
  const settings = useQuickTranslate();
  const [query, setQuery] = React.useState("");
  const guildStore = safe(() => findByStoreName("GuildStore"), null);
  const guilds = Object.values(safe(() => guildStore?.getGuilds?.(), {}) || {});
  const selected = (settings.autoChannelIds || []).map(String);
  const q = query.trim().toLowerCase();
  const sections = guilds
    .map((guild) => ({
      guild,
      channels: listChannelsForGuild(guild).filter(
        (channel) =>
          !q ||
          String(channel.name).toLowerCase().includes(q) ||
          String(guild.name).toLowerCase().includes(q),
      ),
    }))
    .filter((section) => section.channels.length);
  const toggleChannel = (id) => {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : selected.concat(id);
    updateQuickTranslateSettings({ autoChannelIds: next });
  };
  const dmIds =
    safe(() => PrivateChannelSortStore.getPrivateChannelIds?.(), []) || [];
  const dms = dmIds
    .map((id) => safe(() => ChannelStore.getChannel(String(id)), null))
    .filter((channel) => channel && isDM(channel))
    .map((channel) => {
      const recipients = Array.isArray(channel.recipients)
        ? channel.recipients
        : [];
      const label =
        channel.name ||
        recipients
          .map((id) => nameOf(safe(() => UserStore.getUser(String(id)), null)))
          .join(", ") ||
        "Direct message";
      return Object.assign({}, channel, { displayName: label });
    })
    .filter(
      (channel) => !q || String(channel.displayName).toLowerCase().includes(q),
    );
  const row = (channel, label) => {
    const id = String(channel.id);
    return h(Design.TableCheckboxRow, {
      key: id,
      value: id,
      label,
      subLabel: channel.topic || undefined,
      checked: selected.includes(id),
      onPress: () => toggleChannel(id),
    });
  };
  return h(
    RN.ScrollView,
    {
      style: { flex: 1 },
      keyboardShouldPersistTaps: "handled",
      contentContainerStyle: { padding: 16, paddingBottom: 40 },
    },
    h(
      Design.Text,
      { style: { color: palette().sub, fontSize: 13, marginBottom: 12 } },
      "Select only the channels and DMs where new incoming messages should be translated. " +
        selected.length +
        " selected.",
    ),
    h(CustomInput, {
      value: query,
      placeholder: "Search channels, servers, or DMs",
      onChangeText: setQuery,
      autoCorrect: false,
      style: { marginBottom: 16 },
    }),
    dms.length
      ? h(
          CustomSection,
          { title: "Direct messages" },
          ...dms.map((channel) =>
            row(channel, channel.displayName),
          ),
        )
      : null,
    ...sections.map((section) =>
      h(
        CustomSection,
        { key: section.guild.id, title: section.guild.name || "Server" },
        ...section.channels.map((channel) =>
          row(channel, "# " + channel.name),
        ),
      ),
    ),
    !dms.length && !sections.length
      ? h(
          Design.Text,
          {
            style: {
              color: palette().sub,
              fontSize: 14,
              paddingVertical: 22,
              textAlign: "center",
            },
          },
          "No channels or DMs found. Open them once so the channel list can load.",
        )
      : null,
  );
}
const TargetOutPage = () =>
  React.createElement(LangPicker, { field: "targetOut" });
const SourceOutPage = () =>
  React.createElement(LangPicker, { field: "sourceOut" });
const TargetInPage = () =>
  React.createElement(LangPicker, { field: "targetIn" });
function Settings() {
  const h = React.createElement;
  const navigation = NavigationNative.useNavigation();
  const settings = useQuickTranslate();
  const go = (title, render) =>
    navigation.push("DariussQuickTranslatePage", { title, render });
  const C = palette();
  const toggle = (title, subtitle, value, change, icon) =>
    h(CustomRow, {
      title,
      subtitle,
      icon,
      trailing: h(CustomSwitch, { value, onChange: change }),
    });
  if (!settings._hasHydrated)
    return h(
      RN.View,
      {
        style: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        },
      },
      h(
        Design.Text,
        { style: { color: C.sub, fontSize: 15 } },
        "Loading saved Quick Translate settings…",
      ),
    );
  return h(
    RN.ScrollView,
    {
      style: { flex: 1 },
      contentContainerStyle: settingsContent,
    },
    h(
      Design.TableRadioGroup,
      {
        title: "Translation service",
        value: settings.provider === "deepl" ? "deepl" : "google",
        onChange: (provider) => updateQuickTranslateSettings({ provider }),
      },
      h(Design.TableRadioRow, {
        value: "google",
        icon: rowIcon("lang"),
        label: "Google Translate",
        subLabel: "No key required · selected by default",
      }),
      h(Design.TableRadioRow, {
        value: "deepl",
        icon: rowIcon("key"),
        label: "DeepL",
        subLabel: "Uses your personal API key · Google fallback",
      }),
    ),
    h(
      React.Fragment,
      null,
      settings.provider === "deepl"
        ? h(
            RN.View,
            {
              style: {
                padding: 14,
                borderTopWidth: 1,
                borderTopColor: C.card2,
              },
            },
            h(
              Design.Text,
              {
                style: {
                  color: C.text,
                  fontSize: 14,
                  fontWeight: "600",
                  marginBottom: 8,
                },
              },
              "DeepL API key",
            ),
            h(CustomInput, {
              value: settings.deeplApiKey || "",
              placeholder: "Paste your API key",
              autoCapitalize: "none",
              autoCorrect: false,
              secureTextEntry: true,
              onChangeText: (deeplApiKey) =>
                updateQuickTranslateSettings({ deeplApiKey }),
            }),
            h(
              Design.Text,
              {
                style: {
                  color: C.sub,
                  fontSize: 12,
                  marginTop: 7,
                  lineHeight: 17,
                },
              },
              "Your key is stored in this plugin’s local settings. Free API keys ending in :fx are supported.",
            ),
          )
        : null,
    ),
    h(
      CustomSection,
      { title: "Translation rules" },
      h(
        RN.View,
        { style: { padding: 14 } },
        h(
          Design.Text,
          {
            style: {
              color: C.text,
              fontSize: 15,
              fontWeight: "600",
              marginBottom: 5,
            },
          },
          "Keep words unchanged",
        ),
        h(
          Design.Text,
          {
            style: {
              color: C.sub,
              fontSize: 12,
              lineHeight: 16,
              marginBottom: 9,
            },
          },
          "Separate words with commas or new lines. Matching whole words keep their original form.",
        ),
        h(CustomInput, {
          value: (settings.protectedWords || []).join(", "),
          placeholder: "e.g. names, terms",
          multiline: true,
          textAlignVertical: "top",
          onChangeText: (value) => {
            const protectedWords = Array.from(
              new Set(
                String(value || "")
                  .split(/[,\n]+/)
                  .map((word) => word.trim())
                  .filter(Boolean),
              ),
            ).slice(0, 100);
            updateQuickTranslateSettings({ protectedWords });
          },
          style: { minHeight: 88, paddingVertical: 11 },
        }),
      ),
    ),
    h(
      CustomSection,
      { title: "Auto-detect overrides" },
      h(CustomRow, {
        title: "Word language rules",
        subtitle:
          (settings.wordLanguageRules || []).length +
          " rules · Auto-detect only",
        icon: "lang",
        last: true,
        onPress: () => go("Word language rules", WordLanguageRulesPage),
      }),
    ),
    h(
      CustomSection,
      { title: "Languages" },
      h(CustomRow, {
        title: "Translate my messages to",
        subtitle: languageLabel(settings.targetOut),
        icon: "↗",
        onPress: () => go("Translate my messages to", TargetOutPage),
      }),
      h(CustomRow, {
        title: "My messages are written in",
        subtitle: languageLabel(settings.sourceOut),
        icon: "↙",
        onPress: () => go("My messages are written in", SourceOutPage),
      }),
      h(CustomRow, {
        title: "Quick translate messages to",
        subtitle: languageLabel(settings.targetIn),
        icon: "lang",
        onPress: () => go("Quick translate messages to", TargetInPage),
      }),
      h(CustomRow, {
        title: "Quick languages",
        subtitle:
          quickLanguages(settings).length + " of " + MAX_FAVS + " selected",
        icon: "★",
        last: true,
        onPress: () => go("Quick languages", FavPicker),
      }),
    ),
    h(
      CustomSection,
      { title: "Chat composer" },
      toggle(
        "Show translate button",
        "Show the translate control in the chat composer.",
        settings.showButton !== false,
        (v) => {
          if (!v) armed = null;
          updateQuickTranslateSettings({ showButton: v });
          notifyButton();
        },
        "lang",
      ),
      toggle(
        "Translate before sending",
        "Send becomes Translate; tap again to send.",
        settings.draftBeforeSend !== false,
        (v) => {
          updateQuickTranslateSettings({ draftBeforeSend: v });
          notifyButton();
        },
        "reply",
      ),
      toggle(
        "Highlight Translate Draft button",
        "Use a blue Send-style button for Translate Draft.",
        settings.highlightDraftButton !== false,
        (v) => updateQuickTranslateSettings({ highlightDraftButton: v }),
        "paint",
      ),
      toggle(
        "Remember language per chat",
        "Store each chat’s default language separately.",
        settings.rememberLanguagesPerChat !== false,
        (v) => updateQuickTranslateSettings({ rememberLanguagesPerChat: v }),
        "chat",
      ),
      toggle(
        "Keep translate active",
        "In normal mode, keep translating sent messages until you turn it off.",
        !!settings.keepArmed,
        (v) => {
          updateQuickTranslateSettings({ keepArmed: v });
          notifyButton();
        },
        "power",
      ),
      h(CustomRow, {
        title: "Button position",
        icon: "gear",
        subtitle:
          settings.anchor === "send"
            ? "Next to the Send button. To turn off translation, hold the Translate icon and tap Turn off Translate."
            : "Next to the + button",
        onPress: () => {
          const sheets = safe(() => findByProps("showSimpleActionSheet"), null);
          if (!sheets?.showSimpleActionSheet) {
            toast("Could not open position options");
            return;
          }
          const hide = safe(
            () => findByProps("openLazy", "hideActionSheet"),
            null,
          );
          const savePosition = (anchor) => {
            useQuickTranslate.getState().updateSettings({ anchor });
            notifyButton();
            safe(() => hide?.hideActionSheet?.(), null);
          };
          sheets.showSimpleActionSheet({
            key: "QTButtonPosition",
            header: { title: "Button position" },
            options: [
              {
                label: "Next to the + button",
                isMarked: settings.anchor !== "send",
                onPress: () => savePosition("actions"),
              },
              {
                label: "Next to the Send button",
                isMarked: settings.anchor === "send",
                onPress: () => savePosition("send"),
              },
            ],
          });
        },
      }),
      toggle(
        "Hide Gift button",
        "Hide the Gift button in the chat composer.",
        !!settings.hideGiftButton,
        (v) => {
          updateQuickTranslateSettings({ hideGiftButton: v });
          toast("Restart Discord to apply this setting");
        },
        "GiftIcon",
      ),
    ),
    h(
      CustomSection,
      { title: "Appearance" },
      toggle(
        "Immersive translation",
        "Show the translation below the original message. Turn off to replace its text.",
        !!settings.immersive,
        (v) => {
          updateQuickTranslateSettings({ immersive: v });
          refreshTranslated();
        },
        "text",
      ),
      toggle(
        "Show detected source language",
        "Show a compact source → target code below the translation.",
        !!settings.showSourceLanguage,
        (v) => {
          updateQuickTranslateSettings({ showSourceLanguage: v });
          refreshTranslated();
          if (v)
            toast("Translate a message to see its source and target codes");
        },
        "lang",
      ),
      h(CustomRow, {
        title: "Translation color",
        icon: "paint",
        trailing: h(
          RN.View,
          { style: { flexDirection: "row", alignItems: "center" } },
          h(RN.View, {
            style: {
              width: 15,
              height: 15,
              borderRadius: 5,
              backgroundColor: translationColor(),
              marginRight: 9,
            },
          }),
          h(Design.Text, { style: { color: C.sub, fontSize: 21 } }, "›"),
        ),
        last: true,
        onPress: () => go("Translation color", ColorPicker),
      }),
    ),
    h(
      CustomSection,
      { title: "Incoming messages" },
      toggle(
        "Immersive auto-translate",
        "Show auto-translations below original.",
        !!settings.autoIncomingImmersive,
        (v) => {
          updateQuickTranslateSettings({ autoIncomingImmersive: v });
          refreshTranslated();
        },
        "bell",
      ),
      h(CustomRow, {
        title: "Automatic channels and DMs",
        subtitle: (settings.autoChannelIds || []).length + " selected",
        icon: "☷",
        last: true,
        onPress: () => {
          toast("Loading, please wait…");
          const timer = setTimeout(() => {
            if (pluginStarted)
              go("Automatic channels and DMs", AutoChannelsPage);
          }, 100);
          unpatches.push(() => clearTimeout(timer));
        },
      }),
    ),
    h(
      CustomSection,
      { title: "Translation history & cache" },
      toggle(
        "Save translation history",
        "Store translated messages and drafts locally in Translation history.",
        settings.saveHistory !== false,
        (v) => updateQuickTranslateSettings({ saveHistory: v }),
        "time",
      ),
      toggle(
        "Keep translations after restart",
        "Restore saved translations when Discord restarts.",
        settings.keepMessageTranslations !== false,
        (v) => {
          updateQuickTranslateSettings({
            keepMessageTranslations: v,
            messageTranslations: v ? settings.messageTranslations || [] : [],
          });
        },
        "store",
      ),
      h(CustomRow, {
        title: "Translation history",
        subtitle: (settings.historyEntries || []).length + " saved locally",
        icon: "◷",
        onPress: () => go("Translation history", HistoryPage),
      }),
      h(
        RN.View,
        { style: { paddingHorizontal: 13, paddingBottom: 11 } },
        h(
          Design.Text,
          { style: { color: C.sub, fontSize: 12, marginTop: 10 } },
          "Removes saved history, message translations and cached results.",
        ),
        h(CustomAction, {
          title: "Clear translation history & cache",
          icon: "trash",
          secondary: true,
          onPress: () => {
            clearTranslationData();
          },
        }),
      ),
    ),
    h(KitGuide, {
      title: "Quick guide",
      steps: [
        [
          "Translate a message",
          "Long-press a message to translate it, view the original, or open more translation actions.",
        ],
        [
          "Translate a draft",
          "Use the Translate button in the composer to translate what you are typing before it is sent. With Translate before sending on, Send turns into Translate and a second tap sends.",
        ],
        [
          "Pick a service and languages",
          "Choose Google Translate (no key needed) or DeepL (your own API key), then set separate languages for your outgoing and incoming messages.",
        ],
        [
          "Automatic translation",
          "Select the channels and DMs where new incoming messages should be translated automatically. Immersive mode shows the translation below the original.",
        ],
        [
          "History and comparing",
          "Translation history keeps your saved translations. Use Try DeepL or Try Google to compare the other service without changing your default, copy a translation, or jump to its message.",
        ],
        [
          "Protect words",
          "Add protected words, such as names or terms, that should never be translated.",
        ],
      ],
    }),
    h(
      Design.Text,
      {
        style: {
          color: C.sub,
          fontSize: 12,
          textAlign: "center",
          marginTop: 1,
          opacity: 0.7,
        },
      },
      "Quick Translate " + BUILD,
    ),
  );
}
/* ------------------------------------------------------------------ */
/* plugin                                                              */
/* ------------------------------------------------------------------ */
const step = (name, fn) => {
  try {
    fn();
  } catch (e) {
    console.error(`[QuickTranslate] ${name} failed:`, e);
    reportIntegrationError(e);
  }
};
function migrateSettings() {
  let stored = useQuickTranslate.getState();
  if (stored.settingsVersion < 2) {
    stored.updateSettings({
      keepArmed: true,
      hideGiftButton: true,
      settingsVersion: 2,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 3) {
    stored.updateSettings({
      showSourceLanguage: false,
      autoIncoming: false,
      includeDMs: false,
      excludedChannelIds: [],
      translateDraft: false,
      historyEntries: [],
      cacheEntries: [],
      settingsVersion: 3,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 4) {
    stored.updateSettings({
      liveTranslateInput: undefined,
      translateDraft: undefined,
      settingsVersion: 4,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 5) {
    stored.updateSettings({
      autoChannelIds: Array.isArray(stored.autoChannelIds)
        ? stored.autoChannelIds
        : [],
      autoIncomingImmersive: stored.autoIncomingImmersive !== false,
      includeDMs: undefined,
      excludedChannelIds: undefined,
      settingsVersion: 5,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 6) {
    stored.updateSettings({
      immersive: true,
      translateOnSend: undefined,
      liveTranslateInput: undefined,
      settingsVersion: 6,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 7) {
    stored.updateSettings({
      draftBeforeSend: true,
      saveHistory: stored.saveHistory !== false,
      rememberDrafts: stored.rememberDrafts !== false,
      rememberedDrafts:
        stored.rememberedDrafts && typeof stored.rememberedDrafts === "object"
          ? stored.rememberedDrafts
          : {},
      settingsVersion: 7,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 8) {
    stored.updateSettings({
      rememberLanguagesPerChat: stored.rememberLanguagesPerChat !== false,
      chatLanguages:
        stored.chatLanguages && typeof stored.chatLanguages === "object"
          ? stored.chatLanguages
          : {},
      highlightDraftButton: stored.highlightDraftButton !== false,
      settingsVersion: 8,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 9) {
    stored.updateSettings({
      autoIncoming: undefined,
      protectedWords: Array.isArray(stored.protectedWords)
        ? stored.protectedWords
        : [],
      settingsVersion: 9,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 10) {
    stored.updateSettings({ quickTargets: undefined, settingsVersion: 10 });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 11) {
    stored.updateSettings({
      rememberedDrafts: {},
      rememberDrafts: undefined,
      settingsVersion: 11,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 12) {
    const oldMessageTranslations = (
      Array.isArray(stored.messageTranslations)
        ? stored.messageTranslations
        : []
    ).slice();
    if (!oldMessageTranslations.length) {
      for (const entry of Array.isArray(stored.historyEntries)
        ? stored.historyEntries
        : []) {
        if (
          !entry?.messageId ||
          !entry.channelId ||
          typeof entry.translated !== "string"
        )
          continue;
        oldMessageTranslations.push({
          id: String(entry.channelId) + "|" + String(entry.messageId),
          messageId: String(entry.messageId),
          channelId: String(entry.channelId),
          original: entry.original,
          translated: entry.translated,
          source: entry.source || "auto",
          target: entry.target || "en",
          at: Number(entry.at) || Date.now(),
          autoIncoming: (stored.autoChannelIds || [])
            .map(String)
            .includes(String(entry.channelId)),
        });
      }
    }
    stored.updateSettings({
      keepMessageTranslations: stored.keepMessageTranslations !== false,
      messageTranslations: oldMessageTranslations.slice(0, MAX_TRANSLATIONS),
      settingsVersion: 12,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.settingsVersion < 13) {
    stored.updateSettings({
      immersive: true,
      autoIncomingImmersive: true,
      showButton: true,
      draftBeforeSend: true,
      highlightDraftButton: true,
      rememberLanguagesPerChat: true,
      keepArmed: true,
      saveHistory: true,
      hideGiftButton: true,
      settingsVersion: 13,
    });
    stored = useQuickTranslate.getState();
  }
  if (stored.anchor !== "actions" && stored.anchor !== "send")
    stored.updateSettings({ anchor: "actions" });
}
function waitForSettingsHydration() {
  const current = useQuickTranslate.getState();
  if (current._hasHydrated) {
    migrateSettings();
    return;
  }
  let unsubscribe = null;
  unsubscribe = useQuickTranslate.subscribe((next) => {
    if (!next._hasHydrated) return;
    if (unsubscribe) unsubscribe();
    migrateSettings();
    notifyButton();
  });
  unpatches.push(() => {
    if (unsubscribe) unsubscribe();
  });
}
function onChannelSelect(e) {
  const id = e && e.channelId != null ? String(e.channelId) : null;
  if (id === lastChannelId) return;
  lastChannelId = id;
  bridge.text = "";
  bridge.change = null;
  bridge.inst = null;
  bridge.seen = 0;
  if (lastOriginalChannelId && lastOriginalChannelId !== id) {
    lastOriginal = null;
    lastOriginalChannelId = null;
  }
  if (bulkSelectionRequest && id !== bulkSelectionRequest.channelId) {
    bulkSelectionRequest = null;
    notifyButton();
  }
  if (armed) {
    armed = null;
    notifyButton();
  }
}
const originalPlugin = {
  name: "Quick Translate",
  description:
    "Translate incoming and outgoing messages with Google Translate or DeepL.",
  id: "quicktranslate",
  version: "1.0.0-beta",
  start() {
    renderErrors = 0;
    pendingRequestCount = 0;
    lastRequestAt = 0;
    requestTail = Promise.resolve();
    step("textBridge", installTextBridge);
    step("settingsHydration", waitForSettingsHydration);
    step("localData", hydrateLocalData);
    step("channel", () => {
      lastChannelId = currentChannelId();
      FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
      unpatches.push(() =>
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect),
      );
    });
    step("incomingMessages", () => {
      FluxDispatcher.subscribe("MESSAGE_CREATE", onIncomingMessage);
      unpatches.push(() =>
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onIncomingMessage),
      );
    });
    step("render", patchRender);
    step("actionSheet", patchActionSheet);
    step("inputCapture", installInputCapture);
    step("send", patchSend);
    step("chatButton", patchChatButton);
  },
  stop() {
    const previousRows = Array.from(translations.entries());
    pluginStarted = false;
    cancelRequests();
    for (const u of unpatches.splice(0)) {
      try {
        u();
      } catch (_) {
        /* ignore */
      }
    }
    if (renderUnpatch) {
      try {
        renderUnpatch();
      } catch (_) {
        /* ignore */
      }
      renderUnpatch = null;
    }
    translations.clear();
    cacheGeneration++;
    cache.clear();
    wordCache.clear();
    inFlight.clear();
    autoSeen.clear();
    bulkSelectionRequest = null;
    persistentReady = false;
    historyEntries = [];
    bridge.text = "";
    bridge.change = null;
    bridge.inst = null;
    armed = null;
    lastOriginal = null;
    lastOriginalChannelId = null;
    notifyButton();
    for (const [id, entry] of previousRows)
      if (entry.ch) refreshRow(entry.ch, id);
  },
  settings: Settings,
};

export default originalPlugin;
export {
  useQuickTranslate,
  Settings,
  LangPicker,
  FavPicker,
  ColorPicker,
  WordLanguageRulesPage,
  HistoryPage,
  AutoChannelsPage,
  TranslateButton,
  ComposerSendSlot,
  BulkMessageSelector,
  CustomSection,
  CustomRow,
  CustomSwitch,
  CustomAction,
  CustomInput,
  KitGuide,
  palette,
  protect,
  restore,
  translate,
  callApi,
  enqueueRequest,
  installTextBridge,
  patchSend,
  patchRender,
  patchChatButton,
  messagePlan,
  showOriginal,
  clearTranslationData,
  getChatLanguages,
  saveChatLanguages,
  onIncomingMessage,
  openBulkSelection,
  openMessageTranslationPanel,
  openBulkTranslationPanel,
  translateCurrentText,
  restoreOriginal,
  installInputCapture,
};
