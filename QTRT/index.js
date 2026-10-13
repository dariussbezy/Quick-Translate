"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { findAssetId } = rain.api.assets;
const { after, before, instead } = rain.api.patcher;
const { createPluginStore } = rain.api.storage;
const { showToast } = rain.api.ui.toasts;
const { findInReactTree } = rain.utils;
const { findByName, findByProps, findByStoreName, findByTypeDisplayName } = rain.metro;
const { clipboard, FluxDispatcher, NavigationNative, React, ReactNative: RN } = rain.metro.common;
const { ChannelStore, MessageStore, PrivateChannelSortStore, SelectedChannelStore, UserStore } = rain.metro.common.stores;
/* ------------------------------------------------------------------ */
/* constants + settings store                                          */
/* ------------------------------------------------------------------ */
const BUILD = "v1.11.0-rain";
const FLAG_TOGGLE = 0x04000000;
const ACCENT = "#8EA1FF";
const MAX_TRANSLATIONS = 300;
const MAX_CACHE = 200;
const MAX_HISTORY = 100;
const MAX_FAVS = 6;
const TIMEOUT = 12000;
const REQUEST_GAP = 450;
const PROTECT = /```[\s\S]*?```|`[^`\n]+`|<a?:\w+:\d+>|<[@#][!&]?\d+>|<t:-?\d+(?::[A-Za-z])?>|https?:\/\/[^\s<>]+/g;
const INLINE = new Set(["text", "strong", "em", "u", "s", "inlineCode", "customEmoji"]);
const HEX = /^#[0-9A-Fa-f]{6}$/;
const LANGS = [
    ["en", "English"], ["ro", "Romanian"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"],
    ["pt", "Portuguese"], ["ru", "Russian"], ["uk", "Ukrainian"], ["pl", "Polish"], ["nl", "Dutch"], ["tr", "Turkish"],
    ["ar", "Arabic"], ["he", "Hebrew"], ["hi", "Hindi"], ["ja", "Japanese"], ["ko", "Korean"],
    ["zh-CN", "Chinese (Simplified)"], ["zh-TW", "Chinese (Traditional)"], ["id", "Indonesian"], ["th", "Thai"],
    ["vi", "Vietnamese"], ["sv", "Swedish"], ["da", "Danish"], ["no", "Norwegian"], ["fi", "Finnish"], ["cs", "Czech"],
    ["sk", "Slovak"], ["hu", "Hungarian"], ["el", "Greek"], ["bg", "Bulgarian"], ["sr", "Serbian"], ["hr", "Croatian"],
    ["sl", "Slovenian"], ["lt", "Lithuanian"], ["lv", "Latvian"], ["et", "Estonian"], ["fa", "Persian"], ["bn", "Bengali"],
    ["ur", "Urdu"], ["ms", "Malay"], ["ta", "Tamil"], ["te", "Telugu"], ["sw", "Swahili"], ["af", "Afrikaans"],
    ["ca", "Catalan"], ["tl", "Filipino"], ["is", "Icelandic"], ["ga", "Irish"], ["cy", "Welsh"], ["sq", "Albanian"],
    ["mk", "Macedonian"], ["ka", "Georgian"], ["hy", "Armenian"], ["az", "Azerbaijani"], ["kk", "Kazakh"],
    ["uz", "Uzbek"], ["mn", "Mongolian"], ["ne", "Nepali"], ["si", "Sinhala"], ["my", "Myanmar"], ["km", "Khmer"],
    ["lo", "Lao"], ["la", "Latin"], ["eo", "Esperanto"],
];
const LANG_NAME = new Map(LANGS);
const COLOR_PRESETS = [
    ["Default", ACCENT], ["Red", "#ED4245"], ["Orange", "#F07B3E"], ["Gold", "#F1C40F"], ["Green", "#43B581"],
    ["Teal", "#1ABC9C"], ["Blue", "#3498DB"], ["Indigo", "#5865F2"], ["Purple", "#9B59B6"], ["Pink", "#EB459E"], ["Gray", "#80848E"],
];
const { useStore: useQuickTranslate, settings: qt } = createPluginStore("quicktranslate", {
    settingsVersion: 0,
    targetOut: "en",
    targetIn: "en",
    sourceOut: "auto",
    immersive: true,
    translationColor: ACCENT,
    showButton: true,
    keepArmed: true,
    hideGiftButton: true,
    provider: "google",
    deeplApiKey: "",
    anchor: "actions",
    favLangs: ["en", "es", "fr", "de", "ro", "ru"],
    showSourceLanguage: false,
    autoIncoming: false,
    autoChannelIds: [],
    autoIncomingImmersive: true,
    historyEntries: [],
    cacheEntries: [],
});
const translations = new Map();
const cache = new Map();
const inFlight = new Map();
let cacheGeneration = 0;
const autoSeen = new Set();
const unpatches = [];
const bridge = { text: "", change: null, inst: null, seen: 0 };
const refWrappers = new WeakMap();
const buttonListeners = new Set();
let armed = null;
let lastChannelId = null;
let lastOriginal = null;
let renderErrors = 0;
let renderUnpatch = null;
let ThemeStore;
let persistentReady = false;
let historyEntries = [];
let requestTail = Promise.resolve();
let lastRequestAt = 0;
let bulkSelectionRequest = null;
let bulkSelectionNonce = 0;
const toast = (t) => { try {
    showToast(t);
}
catch (_) { /* ignore */ } };
const safe = (fn, fallback) => { try {
    return fn();
}
catch (_) {
    return fallback;
} };
const trimMap = (m, max) => { while (m.size > max)
    m.delete(m.keys().next().value); };
const langName = (code) => (code === "auto" ? "Auto-detect" : LANG_NAME.get(code) || code);
const notifyButton = () => buttonListeners.forEach(f => { try {
    f();
}
catch (_) { /* ignore */ } });
const getMessage = (c, id) => safe(() => MessageStore.getMessage(c, id) || null, null);
const getChannel = (id) => safe(() => (id ? ChannelStore.getChannel(id) : null), null);
const isDM = (ch) => !!ch && (ch.type === 1 || ch.type === 3);
const nameOf = (u) => (u ? u.globalName || u.global_name || u.username || "Unknown" : "Unknown");
function currentChannelId() {
    return safe(() => SelectedChannelStore.getChannelId?.() ?? SelectedChannelStore.getCurrentlySelectedChannelId?.() ?? null, null);
}
function persistLocalData() {
    if (!persistentReady)
        return;
    try {
        useQuickTranslate.getState().updateSettings({
            historyEntries: historyEntries.slice(0, MAX_HISTORY),
            cacheEntries: Array.from(cache.entries()).slice(-MAX_CACHE),
        });
    }
    catch (_) { /* settings may still be hydrating */ }
}
function clearTranslationCache() {
    const state = useQuickTranslate.getState();
    const oldCount = Math.max(cache.size, Array.isArray(state.cacheEntries) ? state.cacheEntries.length : 0);
    cacheGeneration++;
    cache.clear();
    inFlight.clear();
    state.updateSettings({ cacheEntries: [] });
    persistLocalData();
    toast(oldCount ? `Translation cache cleared (${oldCount} entries)` : "Translation cache is already empty");
}
function hydrateLocalData() {
    const generationAtStart = cacheGeneration;
    const load = () => {
        const state = useQuickTranslate.getState();
        historyEntries = Array.isArray(state.historyEntries) ? state.historyEntries.filter((x) => x && typeof x.original === "string" && typeof x.translated === "string").slice(0, MAX_HISTORY) : [];
        cache.clear();
        if (generationAtStart === cacheGeneration && Array.isArray(state.cacheEntries)) {
            for (const entry of state.cacheEntries.slice(-MAX_CACHE)) {
                if (Array.isArray(entry) && typeof entry[0] === "string" && entry[1] && typeof entry[1].text === "string")
                    cache.set(entry[0], entry[1]);
            }
        }
        persistentReady = true;
        persistLocalData();
    };
    const state = useQuickTranslate.getState();
    if (state._hasHydrated) {
        load();
        return;
    }
    const unsubscribe = useQuickTranslate.subscribe((next) => {
        if (!next._hasHydrated)
            return;
        unsubscribe();
        load();
    });
    unpatches.push(unsubscribe);
}
function addHistory(original, translated, result, target, channelId = currentChannelId()) {
    if (!persistentReady || !translated || result.same)
        return;
    const provider = result.provider || qt.provider || "google";
    const id = [provider, result.src || "auto", target, original].join("|");
    historyEntries = historyEntries.filter(item => item.id !== id);
    historyEntries.unshift({
        id, original, translated, source: result.src || "auto", target,
        provider, at: Date.now(), channelId,
    });
    historyEntries = historyEntries.slice(0, MAX_HISTORY);
    persistLocalData();
}
function enqueueRequest(work) {
    const task = requestTail.catch(() => undefined).then(async () => {
        const wait = Math.max(0, REQUEST_GAP - (Date.now() - lastRequestAt));
        if (wait)
            await new Promise(resolve => setTimeout(resolve, wait));
        lastRequestAt = Date.now();
        return work();
    });
    requestTail = task.then(() => undefined, () => undefined);
    return task;
}
function palette() {
    const light = safe(() => {
        ThemeStore = ThemeStore || findByStoreName("ThemeStore");
        return !!ThemeStore && ThemeStore.theme === "light";
    }, false);
    return light
        ? { text: "#060607", sub: "#5C5E66", bg: "#FFFFFF", card: "#F2F3F5", blurple: "#5865F2", card2: "rgba(0,0,0,0.045)", chip: "rgba(0,0,0,0.07)", press: "rgba(0,0,0,0.06)", off: "#B5BAC1" }
        : { text: "#FFFFFF", sub: "#B5BAC1", bg: "#1E1F22", card: "#2B2D31", blurple: "#5865F2", card2: "rgba(255,255,255,0.06)", chip: "rgba(255,255,255,0.10)", press: "rgba(255,255,255,0.07)", off: "#4E5058" };
}
const translationColor = () => (HEX.test(String(qt.translationColor || "")) ? String(qt.translationColor).toUpperCase() : ACCENT);
const LANGUAGE_FLAGS = {
    en: "🇺🇸", ro: "🇷🇴", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪", it: "🇮🇹", pt: "🇧🇷", ru: "🇷🇺", uk: "🇺🇦", pl: "🇵🇱",
    nl: "🇳🇱", tr: "🇹🇷", ar: "🇸🇦", he: "🇮🇱", hi: "🇮🇳", ja: "🇯🇵", ko: "🇰🇷", "zh-CN": "🇨🇳", "zh-TW": "🇹🇼",
    id: "🇮🇩", th: "🇹🇭", vi: "🇻🇳", sv: "🇸🇪", da: "🇩🇰", no: "🇳🇴", fi: "🇫🇮", cs: "🇨🇿", sk: "🇸🇰", hu: "🇭🇺",
    el: "🇬🇷", bg: "🇧🇬", sr: "🇷🇸", hr: "🇭🇷", sl: "🇸🇮", lt: "🇱🇹", lv: "🇱🇻", et: "🇪🇪", fa: "🇮🇷", bn: "🇧🇩",
    ur: "🇵🇰", ms: "🇲🇾", sw: "🇰🇪", af: "🇿🇦", tl: "🇵🇭", is: "🇮🇸", ga: "🇮🇪",
};
const languageLabel = (code, name = langName(code)) => (LANGUAGE_FLAGS[code] ? LANGUAGE_FLAGS[code] + "  " : "") + name;
function CustomSection(props) {
    const h = React.createElement;
    const C = palette();
    return h(RN.View, { style: { marginBottom: 22 } }, h(RN.Text, { style: { color: C.sub, fontSize: 13, fontWeight: "700", letterSpacing: 0.4, marginHorizontal: 5, marginBottom: 9, textTransform: "uppercase" } }, props.title), h(RN.View, { style: { backgroundColor: C.card, borderRadius: 17, overflow: "hidden", borderWidth: 1, borderColor: C.card2 } }, props.children));
}
function CustomRow(props) {
    const h = React.createElement;
    const C = palette();
    return h(RN.Pressable, { onPress: props.onPress, disabled: !props.onPress, style: ({ pressed }) => ({ minHeight: 58, paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", backgroundColor: pressed ? C.press : "transparent" }) }, props.icon ? h(RN.Text, { style: { width: 30, fontSize: 18, color: C.sub, marginRight: 7 } }, props.icon) : null, h(RN.View, { style: { flex: 1, minWidth: 0, paddingRight: 8 } }, h(RN.Text, { numberOfLines: 1, style: { color: C.text, fontSize: 16, fontWeight: "600" } }, props.title), props.subtitle ? h(RN.Text, { numberOfLines: 2, style: { color: C.sub, fontSize: 13, marginTop: 3, lineHeight: 18 } }, props.subtitle) : null), props.trailing || null, !props.last ? h(RN.View, { style: { position: "absolute", bottom: 0, left: props.icon ? 52 : 15, right: 0, height: 1, backgroundColor: C.card2 } }) : null);
}
function CustomSwitch(props) {
    const h = React.createElement;
    const C = palette();
    const on = !!props.value;
    const position = React.useRef(new RN.Animated.Value(on ? 1 : 0)).current;
    React.useEffect(() => { RN.Animated.spring(position, { toValue: on ? 1 : 0, speed: 22, bounciness: 3, useNativeDriver: true }).start(); }, [on]);
    return h(RN.Pressable, { accessibilityRole: "switch", accessibilityState: { checked: on }, onPress: () => props.onChange(!on), hitSlop: 8, style: { width: 48, height: 29, borderRadius: 16, padding: 3, justifyContent: "center", backgroundColor: on ? C.blurple : C.off } }, h(RN.Animated.View, { style: { width: 23, height: 23, borderRadius: 12, backgroundColor: "#FFFFFF", elevation: 1, transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, 19] }) }] } }));
}
function CustomAction(props) {
    const h = React.createElement;
    const C = palette();
    return h(RN.Pressable, { onPress: props.onPress, disabled: props.disabled, style: ({ pressed }) => ({ minHeight: 48, borderRadius: 13, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 9, backgroundColor: props.secondary ? C.chip : C.blurple, opacity: props.disabled ? 0.45 : pressed ? 0.75 : 1 }) }, h(RN.Text, { style: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 } }, props.title));
}
function CustomInput(props) {
    const h = React.createElement;
    const C = palette();
    return h(RN.TextInput, { ...props, placeholderTextColor: C.sub, style: [{ minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: C.off, backgroundColor: C.bg, color: C.text, paddingHorizontal: 14, fontSize: 16 }, props.style] });
}
function copyText(text) {
    try {
        clipboard.setString(text);
        toast("Copied");
    }
    catch (_) {
        toast("Could not copy");
    }
}
/* ------------------------------------------------------------------ */
/* translation engine                                                  */
/* ------------------------------------------------------------------ */
function fetchT(url, opts) {
    let timer;
    const clear = () => clearTimeout(timer);
    return Promise.race([
        fetch(url, opts),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out")), TIMEOUT); }),
    ]).then(res => { clear(); return res; }, err => { clear(); throw err; });
}
function callApi(provider, text, tl, sl) {
    if (provider === "deepl") {
        const key = String(qt.deeplApiKey || "").trim();
        if (!key)
            return Promise.reject(new Error("Add your DeepL API key in QuickTranslate settings"));
        const endpoint = key.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";
        const deeplCode = (code) => code === "zh-CN" || code === "zh-TW" ? "ZH" : code.toUpperCase();
        const target = tl === "en" ? "EN-US" : tl === "pt" ? "PT-BR" : deeplCode(tl);
        const source = sl && sl !== "auto" ? deeplCode(sl) : undefined;
        const body = { text: [text], target_lang: target };
        if (source)
            body.source_lang = source;
        return fetchT(endpoint, {
            method: "POST",
            headers: { "Authorization": "DeepL-Auth-Key " + key, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }).then(async (res) => {
            const json = await res.json().catch(() => null);
            if (!res.ok)
                throw new Error((json?.message || "DeepL request failed") + " (HTTP " + res.status + ")");
            return json;
        }).then((json) => {
            const result = json?.translations?.[0];
            if (!result?.text)
                throw new Error(json?.message || "DeepL returned an empty translation");
            return { text: String(result.text), src: String(result.detected_source_language || source || "auto").toLowerCase() };
        });
    }
    const params = "client=gtx&dt=t&sl=" + encodeURIComponent(sl || "auto") + "&tl=" + encodeURIComponent(tl);
    const base = "https://translate.googleapis.com/translate_a/single?" + params;
    const req = text.length < 1200
        ? fetchT(base + "&q=" + encodeURIComponent(text))
        : fetchT(base, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: "q=" + encodeURIComponent(text),
        });
    return req.then((res) => {
        if (!res.ok)
            throw new Error("HTTP " + res.status);
        return res.json();
    }).then((json) => {
        const segments = Array.isArray(json) && Array.isArray(json[0]) ? json[0] : [];
        const out = segments.map((s) => (s && s[0]) || "").join("");
        if (!out && text.trim())
            throw new Error("Empty response");
        return { text: out, src: (Array.isArray(json) && typeof json[2] === "string" && json[2]) || sl };
    });
}
function prettyToken(t) {
    if (/^<a?:[\w~]+:\d+>$/.test(t))
        return t;
    let m;
    if ((m = /^<@!?(\d+)>$/.exec(t)))
        return "@" + nameOf(safe(() => UserStore.getUser(m[1]), null));
    if ((m = /^<#(\d+)>$/.exec(t)))
        return "#" + ((getChannel(m[1]) || {}).name || "channel");
    if (/^<@&\d+>$/.test(t))
        return "@role";
    if (/^<t:/.test(t))
        return "";
    return t;
}
function protect(text) {
    const tokens = [];
    const out = text.replace(PROTECT, m => { tokens.push(m); return "§" + (tokens.length - 1) + "§"; });
    return { out, tokens };
}
function restore(text, tokens, pretty) {
    const used = new Set();
    let out = text.replace(/§\s*(\d+)\s*§/g, (m, i) => {
        const t = tokens[Number(i)];
        if (t === undefined)
            return m;
        used.add(Number(i));
        return pretty ? prettyToken(t) : t;
    });
    if (!pretty) {
        const missing = tokens.filter((_, i) => !used.has(i));
        if (missing.length)
            out += " " + missing.join(" ");
    }
    return out;
}
function translate(text, tl, sl, pretty, channelId = currentChannelId()) {
    const source = sl || "auto";
    const cacheKey = (qt.provider || "google") + "|" + (pretty ? "p|" : "r|") + source + "|" + tl + "|" + text;
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        addHistory(text, cached.text, cached, tl, channelId);
        return Promise.resolve(cached);
    }
    if (inFlight.has(cacheKey))
        return inFlight.get(cacheKey);
    const { out, tokens } = protect(text);
    if (!out.replace(/§\d+§/g, "").trim())
        return Promise.resolve({ same: true, text, src: source });
    const selectedProvider = qt.provider || "google";
    const generation = cacheGeneration;
    const requestProvider = (provider) => enqueueRequest(() => callApi(provider, out, tl, source));
    const request = (selectedProvider !== "deepl"
        ? requestProvider("google").then(res => Object.assign(res, { provider: "google" }))
        : requestProvider("deepl")
            .then(res => Object.assign(res, { provider: "deepl" }))
            .catch((deeplError) => requestProvider("google")
            .then(res => Object.assign(res, { provider: "google" }))
            .catch((googleError) => { throw new Error("DeepL and Google failed: " + (googleError?.message || deeplError?.message || "request failed")); }))).then(res => {
        const base = String(tl).toLowerCase().split("-")[0];
        const detected = String(res.src || "").toLowerCase().split("-")[0];
        const result = source === "auto" && (!detected || detected === "auto" || detected === base)
            ? { same: true, text, src: res.src, provider: res.provider }
            : { same: false, text: restore(res.text, tokens, pretty), src: res.src, provider: res.provider };
        if (generation === cacheGeneration) {
            cache.set(cacheKey, result);
            trimMap(cache, MAX_CACHE);
        }
        addHistory(text, result.text, result, tl, channelId);
        return result;
    });
    inFlight.set(cacheKey, request);
    request.then(() => { if (inFlight.get(cacheKey) === request)
        inFlight.delete(cacheKey); }, () => { if (inFlight.get(cacheKey) === request)
        inFlight.delete(cacheKey); });
    return request;
}
/* ------------------------------------------------------------------ */
/* chat input bridge (reads / writes the text box)                     */
/* ------------------------------------------------------------------ */
function isChatInput(props) {
    const ph = typeof props.placeholder === "string" ? props.placeholder : "";
    if (ph && /^(message|mesaj|mensaje|nachricht|messag|написать|сообщение)/i.test(ph))
        return true;
    const ch = getChannel(currentChannelId());
    if (!ch)
        return false;
    let name = ch.name;
    if (isDM(ch) && !name) {
        const rid = ch.recipients && ch.recipients[0];
        name = rid ? nameOf(safe(() => UserStore.getUser(rid), null)) : null;
    }
    if (name && name !== "Unknown" && ph.toLowerCase().includes(String(name).toLowerCase()))
        return true;
    // Rain's composer is a multiline, send-enabled input, including in DMs where
    // the placeholder may be omitted by the current Discord build.
    return !!props.multiline && typeof props.onChangeText === "function" &&
        (typeof props.onSubmitEditing === "function" || props.returnKeyType === "send" || props.maxLength === 2000);
}
function installInputCapture() {
    const TI = RN.TextInput;
    if (!TI || typeof TI.render !== "function")
        return;
    unpatches.push(before("render", TI, (args) => {
        try {
            const props = args[0];
            if (!props || !isChatInput(props))
                return;
            bridge.seen = Date.now();
            const original = props.onChangeText;
            bridge.change = typeof original === "function" ? original : null;
            if (typeof props.value === "string")
                bridge.text = props.value;
            args[0] = Object.assign({}, props, {
                onChangeText: (t) => {
                    bridge.text = t;
                    if (original)
                        original(t);
                },
            });
            const ref = args[1];
            let wrapped = ref && typeof ref === "object" ? refWrappers.get(ref) : null;
            if (!wrapped) {
                wrapped = (inst) => {
                    bridge.inst = inst;
                    if (typeof ref === "function")
                        ref(inst);
                    else if (ref && typeof ref === "object")
                        ref.current = inst;
                };
                if (ref && typeof ref === "object")
                    refWrappers.set(ref, wrapped);
            }
            args[1] = wrapped;
        }
        catch (_) { /* ignore */ }
    }));
}
function composerRef() {
    const channelId = currentChannelId();
    if (!channelId)
        return null;
    const api = safe(() => findByProps("getChatInputRef"), null);
    return safe(() => api?.getChatInputRef?.(channelId, 0), null);
}
function readInput() {
    if (Date.now() - bridge.seen < 600000 && String(bridge.text || "").trim())
        return String(bridge.text);
    const ref = composerRef();
    const value = safe(() => typeof ref?.getText === "function" ? ref.getText() :
        typeof ref?.getValue === "function" ? ref.getValue() :
            typeof ref?.text === "string" ? ref.text :
                typeof ref?.value === "string" ? ref.value :
                    typeof ref?.props?.value === "string" ? ref.props.value : "", "");
    return typeof value === "string" ? value : "";
}
function writeInput(text) {
    let ok = false;
    if (bridge.change) {
        try {
            bridge.change(text);
            ok = true;
        }
        catch (_) { /* ignore */ }
    }
    if (bridge.inst && typeof bridge.inst.setNativeProps === "function") {
        try {
            bridge.inst.setNativeProps({ text });
            ok = true;
        }
        catch (_) { /* ignore */ }
    }
    if (!ok) {
        const ref = composerRef();
        try {
            if (typeof ref?.setText === "function") {
                ref.setText(text);
                ok = true;
            }
            else if (typeof ref?.setValue === "function") {
                ref.setValue(text);
                ok = true;
            }
            else if (typeof ref?.setNativeProps === "function") {
                ref.setNativeProps({ text });
                ok = true;
            }
            else if (typeof ref?.clear === "function" && typeof ref?.insertText === "function") {
                ref.clear();
                ref.insertText(text);
                ok = true;
            }
        }
        catch (_) { /* use the captured TextInput bridge when available */ }
    }
    if (ok)
        bridge.text = text;
    return ok;
}
function translateCurrentText(tl, sl) {
    const text = readInput();
    if (!text.trim()) {
        toast("Type a message in the chat box first");
        return Promise.resolve();
    }
    if (!(bridge.change || bridge.inst || composerRef())) {
        toast("Rain could not access the message box; reopen the chat and try again");
        return Promise.resolve();
    }
    return translate(text, tl, sl, false, currentChannelId()).then(result => {
        if (result.same) {
            toast("Already in " + langName(tl));
            return;
        }
        if (writeInput(result.text)) {
            lastOriginal = text;
        }
        else
            toast("Could not update the chat box; the original text is unchanged");
    }).catch((error) => toast("Translation failed: " + (error?.message || error)));
}
function restoreOriginal() {
    if (lastOriginal == null) {
        toast("Nothing to restore");
        return;
    }
    if (writeInput(lastOriginal))
        lastOriginal = null;
    else
        toast("Could not write to the chat box");
}
function patchSend() {
    const Messages = findByProps("sendMessage", "receiveMessage");
    if (!Messages)
        return;
    unpatches.push(instead("sendMessage", Messages, (args, orig) => {
        let pending = null;
        try {
            const msg = args[1];
            const job = armed;
            if (job && msg && typeof msg.content === "string" && msg.content.trim()) {
                if (!qt.keepArmed) {
                    armed = null;
                    notifyButton();
                }
                pending = translate(msg.content, job.tl, job.sl, false, currentChannelId()).then(r => {
                    if (!r.same)
                        args[1] = Object.assign({}, msg, { content: r.text });
                });
            }
        }
        catch (_) {
            toast("Translation failed, sent the original message");
        }
        if (!pending)
            return orig(...args);
        return pending.catch(() => { toast("Translation failed, sent the original message"); }).then(() => orig(...args));
    }));
}
/* ------------------------------------------------------------------ */
/* translated messages in the chat                                     */
/* ------------------------------------------------------------------ */
function refreshRow(channelId, id) {
    const msg = getMessage(channelId, id);
    if (!msg)
        return;
    const guildId = safe(() => getChannel(channelId).guild_id, null);
    setTimeout(() => {
        try {
            FluxDispatcher.dispatch({
                type: "MESSAGE_UPDATE",
                guildId,
                message: { id, channel_id: channelId, guild_id: guildId, flags: (msg.flags | 0) ^ FLAG_TOGGLE },
            });
        }
        catch (_) { /* ignore */ }
    }, 0);
}
function translateMessage(message, tl, silent = false, immersiveOverride, autoIncoming = false) {
    const text = message && message.content;
    if (typeof text !== "string" || !text.trim()) {
        if (!silent)
            toast("This message has no text");
        return Promise.resolve(false);
    }
    const channelId = message.channel_id || message.channelId || currentChannelId();
    if (!silent)
        toast("Translating...");
    return translate(text, tl, "auto", true, channelId).then(r => {
        if (r.same) {
            if (!silent)
                toast("Already in " + langName(tl));
            return true;
        }
        translations.set(message.id, { text: r.text, src: r.src, tl, at: Date.now(), ch: channelId, immersive: immersiveOverride, autoIncoming });
        trimMap(translations, MAX_TRANSLATIONS);
        setTimeout(() => refreshRow(channelId, message.id), silent ? 220 : 0);
        return true;
    }).catch((e) => {
        if (!silent)
            toast("Translation failed: " + (e && e.message ? e.message : e));
        return false;
    });
}
function onIncomingMessage(event) {
    try {
        const state = useQuickTranslate.getState();
        if (!state.autoIncoming)
            return;
        const message = event?.message;
        const channelId = String(event?.channelId || message?.channel_id || "");
        if (!message?.id || !channelId || !message.content?.trim())
            return;
        if (message.type != null && message.type !== 0)
            return;
        const me = safe(() => UserStore.getCurrentUser?.()?.id || UserStore.getCurrentUserId?.(), null);
        if (me && String(message.author?.id) === String(me))
            return;
        if (!(state.autoChannelIds || []).map(String).includes(channelId))
            return;
        const target = state.targetIn || "en";
        if (autoSeen.has(String(message.id)))
            return;
        autoSeen.add(String(message.id));
        if (autoSeen.size > 500)
            autoSeen.delete(autoSeen.values().next().value);
        translateMessage(message, target, true, undefined, true);
    }
    catch (_) { /* incoming translation must never affect message delivery */ }
}
function messageArray(channelId) {
    const result = safe(() => MessageStore.getMessages(channelId), null);
    if (!result)
        return [];
    const value = safe(() => result.toArray(), null) || result._array || result.messages || result;
    return Array.isArray(value) ? value : [];
}
function openBulkSelection(message) {
    const channelId = String(message?.channel_id || message?.channelId || currentChannelId() || "");
    if (!channelId) {
        toast("Could not find this message’s channel");
        return;
    }
    bulkSelectionRequest = { channelId, seedMessage: message, nonce: ++bulkSelectionNonce };
    notifyButton();
}
function BulkMessageSelector(props) {
    const h = React.createElement;
    const C = palette();
    const [selected, setSelected] = React.useState([]);
    const [busy, setBusy] = React.useState(false);
    const [query, setQuery] = React.useState("");
    React.useEffect(() => {
        setSelected(props.request.seedMessage?.id ? [String(props.request.seedMessage.id)] : []);
        setQuery("");
        setBusy(false);
    }, [props.request.nonce]);
    const seed = props.request.seedMessage;
    const seedId = String(seed?.id || "");
    const recent = messageArray(props.request.channelId)
        .filter((m) => m?.id && typeof m.content === "string" && m.content.trim() && (m.type == null || m.type === 0))
        .slice(-70).reverse();
    const messages = [seed, ...recent.filter((m) => String(m.id) !== seedId)].filter((m) => m?.id);
    const q = query.trim().toLowerCase();
    const visible = messages.filter((m) => !q || String(m.content).toLowerCase().includes(q));
    const isAll = visible.length > 0 && visible.every((m) => selected.includes(String(m.id)));
    const toggle = (message) => {
        const id = String(message.id);
        setSelected((current) => current.includes(id) ? current.filter(x => x !== id) : current.concat(id));
    };
    const run = async () => {
        const byId = new Map(messages.map((m) => [String(m.id), m]));
        const chosen = selected.map(id => byId.get(id)).filter(Boolean);
        if (!chosen.length) {
            toast("Select at least one message");
            return;
        }
        setBusy(true);
        props.onClose();
        let done = 0;
        for (const item of chosen)
            if (await translateMessage(item, qt.targetIn || "en", true))
                done++;
        toast(done + " of " + chosen.length + " messages translated");
        setBusy(false);
    };
    return h(RN.Modal, { visible: true, transparent: false, animationType: "none", onRequestClose: props.onClose, statusBarTranslucent: true }, h(RN.View, { style: { flex: 1, backgroundColor: C.bg, paddingTop: 48, paddingHorizontal: 16, paddingBottom: 18 } }, h(RN.View, { style: { flexDirection: "row", alignItems: "center", marginBottom: 14 } }, h(RN.Pressable, { onPress: props.onClose, hitSlop: 10, style: { padding: 8, marginLeft: -8, marginRight: 8 } }, h(RN.Text, { style: { color: C.text, fontSize: 27 } }, "‹")), h(RN.View, { style: { flex: 1 } }, h(RN.Text, { style: { color: C.text, fontSize: 22, fontWeight: "800" } }, "Bulk translate"), h(RN.Text, { style: { color: C.sub, fontSize: 13, marginTop: 2 } }, selected.length + " selected · newest message first"))), h(CustomInput, { value: query, placeholder: "Search messages", onChangeText: setQuery, autoCorrect: false, style: { marginBottom: 10 } }), h(RN.View, { style: { flexDirection: "row", marginBottom: 10 } }, h(RN.View, { style: { flex: 1, marginRight: 6 } }, h(CustomAction, { title: isAll ? "Deselect all" : "Select all", secondary: true, onPress: () => setSelected((current) => isAll ? current.filter(id => !visible.some((m) => String(m.id) === id)) : Array.from(new Set(current.concat(visible.map((m) => String(m.id)))))) })), h(RN.View, { style: { flex: 1, marginLeft: 6 } }, h(CustomAction, { title: "Clear selection", secondary: true, onPress: () => setSelected([]) }))), visible.length ? h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { paddingBottom: 12 } }, h(CustomSection, { title: "Messages" }, ...visible.map((message, index) => {
        const id = String(message.id);
        const marked = selected.includes(id);
        const label = String(message.content).replace(/\s+/g, " ").trim();
        const author = nameOf(message.author);
        return h(CustomRow, { key: id, title: (id === seedId ? "Selected message · " : "") + author, subtitle: label, last: index === visible.length - 1,
            trailing: h(RN.View, { style: { width: 23, height: 23, borderRadius: 6, borderWidth: 1.5, borderColor: marked ? C.blurple : C.off, backgroundColor: marked ? C.blurple : "transparent", alignItems: "center", justifyContent: "center" } }, marked ? h(RN.Text, { style: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" } }, "✓") : null),
            onPress: () => toggle(message) });
    }))) : h(RN.View, { style: { flex: 1, alignItems: "center", justifyContent: "center" } }, h(RN.Text, { style: { color: C.sub } }, "No loaded messages match this search.")), h(CustomAction, { title: busy ? "Translating…" : "Translate " + selected.length + " messages", disabled: busy || !selected.length, onPress: run })));
}
function refreshTranslated() {
    translations.forEach((t, id) => { if (t.ch)
        refreshRow(t.ch, id); });
}
function showOriginal(message) {
    const channelId = message.channel_id || message.channelId || currentChannelId();
    translations.delete(message.id);
    refreshRow(channelId, message.id);
}
function paint(nodes, color) {
    if (!color)
        return nodes;
    return [{
            type: "link",
            target: "usernameOnClick",
            context: { username: "", usernameOnClick: { action: "0", userId: "0", linkColor: color, messageChannelId: "0" } },
            content: nodes.filter(n => n && INLINE.has(n.type)),
        }];
}
function stripOurs(nodes) {
    const out = [];
    for (const n of nodes) {
        if (n && n.__tr)
            continue;
        if (n && Array.isArray(n.content)) {
            const inner = stripOurs(n.content);
            if (!inner.length && n.content.length)
                continue;
            out.push(inner.length === n.content.length ? n : Object.assign({}, n, { content: inner }));
        }
        else
            out.push(n);
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
            nodes.push({ type: "text", content: value.slice(last, match.index), __tr: true });
        const id = match[3];
        const webp = `https://cdn.discordapp.com/emojis/${id}.webp?size=128`;
        nodes.push({ type: "customEmoji", id, alt: match[2], src: match[1] ? webp.replace(".webp", ".gif") : webp, frozenSrc: webp });
        last = match.index + match[0].length;
    }
    if (last < value.length || !nodes.length)
        nodes.push({ type: "text", content: value.slice(last), __tr: true });
    return nodes;
}
function decorate(row, input) {
    const m = row && row.message;
    if (!m)
        return;
    const rowType = input && input.rowType !== undefined ? input.rowType : row.rowType;
    if (rowType !== 1)
        return;
    const tr = translations.get(m.id);
    const ours = m.__trOut && m.content === m.__trOut;
    if (!tr) {
        if (ours)
            m.content = m.__trBase;
        else if (Array.isArray(m.content)) {
            const clean = stripOurs(m.content);
            if (clean.length !== m.content.length)
                m.content = clean;
        }
        return;
    }
    const base = ours ? m.__trBase : Array.isArray(m.content) ? stripOurs(m.content) : null;
    if (!Array.isArray(base))
        return;
    const pc = RN.processColor;
    const color = pc ? pc(translationColor()) : null;
    const text = translatedNodes(tr.text);
    let out;
    const rawSource = String(tr.src || "").toLowerCase();
    const sourceCode = rawSource === "zh-cn" ? "zh-CN" : rawSource === "zh-tw" ? "zh-TW" : rawSource.split("-")[0];
    const sourceHint = qt.showSourceLanguage && sourceCode && sourceCode !== "auto"
        ? [{ type: "text", content: "\n" + sourceCode.toUpperCase() + " → " + String(tr.tl || "").toUpperCase() + "\n", fontSize: 9, color: palette().sub, __tr: true }]
        : [];
    const immersive = tr.autoIncoming ? qt.autoIncomingImmersive : (tr.immersive ?? qt.immersive);
    if (immersive)
        out = base.concat([{ type: "text", content: "\n", __tr: true }], sourceHint, paint(text, color));
    else
        out = sourceHint.concat(paint(text, color));
    if (!out.length)
        return;
    m.__trBase = base;
    m.__trOut = out;
    m.content = out;
}
function onRenderError() {
    renderErrors++;
    if (renderErrors >= 3 && renderUnpatch) {
        try {
            renderUnpatch();
        }
        catch (_) { /* ignore */ }
        renderUnpatch = null;
        toast("Quick Translate: message styling disabled after repeated errors");
    }
}
function patchRender() {
    const RowManager = safe(() => findByName("RowManager"), null);
    if (!RowManager || !RowManager.prototype || typeof RowManager.prototype.generate !== "function") {
        toast("Quick Translate: could not find the message renderer");
        return;
    }
    renderUnpatch = after("generate", RowManager.prototype, (args, ret) => {
        try {
            decorate(ret, args[0]);
        }
        catch (_) {
            onRenderError();
        }
    });
}
/* ------------------------------------------------------------------ */
/* message long-press menu                                             */
/* ------------------------------------------------------------------ */
function messagePlan(message) {
    if (!message || !message.id || typeof message.content !== "string" || !message.content.trim())
        return null;
    const plan = [];
    if (translations.has(message.id)) {
        plan.push({ key: "qt-original", label: "Show original message", press: () => showOriginal(message) });
    }
    else {
        plan.push({ key: "qt-translate", label: "Translate to " + langName(qt.targetIn), press: () => translateMessage(message, qt.targetIn) });
    }
    const channelId = String(message.channel_id || message.channelId || currentChannelId() || "");
    if (channelId)
        plan.push({ key: "qt-select-messages", label: "Bulk translate…", press: () => openBulkSelection(message) });
    plan.push({
        key: "qt-translate-to",
        label: "Translate to...",
        press: () => showLanguagePicker("Translate to", (code) => translateMessage(message, code)),
    });
    const translated = translations.get(message.id);
    if (translated?.text)
        plan.push({ key: "qt-copy-translation", label: "Copy translation", press: () => copyText(translated.text) });
    return plan;
}
function hideLanguageSheet() {
    try {
        findByProps("openLazy", "hideActionSheet").hideActionSheet();
    }
    catch (_) { /* ignore */ }
}
function showLanguagePicker(title, onSelect) {
    const sheets = safe(() => findByProps("showSimpleActionSheet"), null);
    if (!sheets || typeof sheets.showSimpleActionSheet !== "function") {
        toast("Could not open the language list");
        return;
    }
    const favorites = (qt.favLangs || []).filter((code) => LANG_NAME.has(code));
    const showSheet = (languages, key, includeMore) => {
        const options = languages.map(([code, name]) => ({
            label: name,
            onPress: () => {
                hideLanguageSheet();
                onSelect(code);
            },
        }));
        if (includeMore)
            options.push({
                label: "Show more",
                onPress: () => {
                    hideLanguageSheet();
                    setTimeout(() => showSheet(LANGS, key + "All", false), 300);
                },
            });
        sheets.showSimpleActionSheet({ key, header: { title }, options });
    };
    const favoriteLanguages = favorites.map((code) => [code, langName(code)]);
    setTimeout(() => showSheet(favorites.length ? favoriteLanguages : LANGS, "QTTranslateTo", favorites.length > 0), 300);
}
function addRows(tree, plan, lazySheet) {
    const container = findInReactTree(tree, (x) => Array.isArray(x) && x[0]?.type?.name === "ActionSheetRowGroup");
    if (!container || !container[1]) {
        console.log("[QuickTranslate] could not find the action sheet group");
        return;
    }
    const group = container[1];
    const children = group.props?.children;
    if (!Array.isArray(children) || !children[0])
        return;
    if (children.some((c) => typeof c?.key === "string" && c.key.startsWith("qt-")))
        return;
    const tpl = children[0];
    const Row = tpl.type;
    const iconId = findAssetId("LanguageIcon");
    const tplIcon = tpl.props?.icon;
    const icon = tplIcon
        ? {
            $$typeof: tplIcon.$$typeof,
            type: tplIcon.type,
            key: null,
            ref: null,
            props: {
                IconComponent: () => React.createElement(RN.Image, {
                    resizeMode: "cover",
                    style: { width: 24, height: 24, tintColor: palette().text },
                    source: iconId,
                }),
            },
        }
        : undefined;
    const rows = plan.map(item => React.createElement(Row, {
        key: item.key,
        label: item.label,
        icon,
        onPress: () => {
            try {
                lazySheet.hideActionSheet();
            }
            catch (_) { /* ignore */ }
            item.press();
        },
    }));
    const copyIndex = children.findIndex((c) => c?.props?.label?.toUpperCase?.()?.includes("COPY") || c?.props?.message?.toUpperCase?.()?.includes("COPY"));
    if (copyIndex !== -1)
        children.splice(copyIndex, 0, ...rows);
    else
        children.push(...rows);
}
function patchActionSheet() {
    const lazySheet = findByProps("openLazy", "hideActionSheet");
    if (!lazySheet)
        return;
    unpatches.push(before("openLazy", lazySheet, ([component, key, ctx]) => {
        try {
            if (key !== "MessageLongPressActionSheet" || !component || typeof component.then !== "function")
                return;
            const plan = messagePlan(ctx && ctx.message);
            if (!plan)
                return;
            component.then((instance) => {
                const un = after("default", instance, (_, tree) => {
                    React.useEffect(() => () => { un(); }, []);
                    try {
                        addRows(tree, plan, lazySheet);
                    }
                    catch (e) {
                        console.error(e);
                    }
                });
            });
        }
        catch (_) { /* ignore */ }
    }));
}
/* ------------------------------------------------------------------ */
/* chat bar button                                                     */
/* ------------------------------------------------------------------ */
function TranslateButton(props) {
    const h = React.createElement;
    const settings = useQuickTranslate();
    const [busy, setBusy] = React.useState(false);
    const [panelOpen, setPanelOpen] = React.useState(false);
    const [panelPage, setPanelPage] = React.useState("main");
    const [source, setSource] = React.useState(settings.sourceOut || "auto");
    const [target, setTarget] = React.useState(settings.targetOut || "en");
    const [query, setQuery] = React.useState("");
    const didLongPress = React.useRef(false);
    const pressTimer = React.useRef(null);
    const sheetProgress = React.useRef(new RN.Animated.Value(0)).current;
    const buttonScale = React.useRef(new RN.Animated.Value(1)).current;
    const [, tick] = React.useState(0);
    React.useEffect(() => {
        const f = () => tick((x) => x + 1);
        buttonListeners.add(f);
        return () => { buttonListeners.delete(f); if (pressTimer.current)
            clearTimeout(pressTimer.current); };
    }, []);
    React.useEffect(() => {
        if (!panelOpen)
            return;
        sheetProgress.setValue(0);
        RN.Animated.timing(sheetProgress, { toValue: 1, duration: 190, easing: RN.Easing.out(RN.Easing.cubic), useNativeDriver: true }).start();
    }, [panelOpen]);
    if (settings.showButton === false || settings.anchor !== props.position)
        return null;
    const run = (tl, sl) => {
        if (busy)
            return;
        setBusy(true);
        let p;
        try {
            p = translateCurrentText(tl, sl);
        }
        catch (_) {
            p = Promise.resolve();
        }
        return p.then(() => setBusy(false), () => setBusy(false));
    };
    const iconId = findAssetId("LanguageIcon");
    const C = palette();
    const icon = iconId
        ? h(RN.Image, { source: iconId, style: { width: 24, height: 24, tintColor: armed ? ACCENT : C.sub } })
        : h(RN.Text, { style: { fontSize: 20, textAlign: "center", color: armed ? ACCENT : C.sub } }, "\uD83C\uDF10");
    const onPress = () => {
        if (didLongPress.current) {
            didLongPress.current = false;
            return;
        }
        if (armed) {
            armed = null;
            notifyButton();
            toast("Translation turned off");
            return;
        }
        armed = { tl: settings.targetOut || "en", sl: settings.sourceOut || "auto" };
        notifyButton();
        toast(settings.keepArmed
            ? "Translation is active until you turn it off"
            : "Translation will apply to your next message");
    };
    const openPanel = () => {
        didLongPress.current = true;
        setSource(settings.sourceOut || "auto");
        setTarget(settings.targetOut || "en");
        setQuery("");
        setPanelPage("main");
        setPanelOpen(true);
    };
    const startPress = () => {
        didLongPress.current = false;
        RN.Animated.timing(buttonScale, { toValue: 0.92, duration: 75, useNativeDriver: true }).start();
        if (pressTimer.current)
            clearTimeout(pressTimer.current);
        pressTimer.current = setTimeout(() => {
            pressTimer.current = null;
            openPanel();
        }, 450);
    };
    const finishPress = () => {
        RN.Animated.spring(buttonScale, { toValue: 1, speed: 24, bounciness: 4, useNativeDriver: true }).start();
        if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
        }
        if (!didLongPress.current)
            onPress();
        didLongPress.current = false;
    };
    const cancelPress = () => {
        RN.Animated.spring(buttonScale, { toValue: 1, speed: 24, bounciness: 4, useNativeDriver: true }).start();
        if (pressTimer.current)
            clearTimeout(pressTimer.current);
        pressTimer.current = null;
        didLongPress.current = false;
    };
    const closePanel = () => {
        setPanelOpen(false);
        setPanelPage("main");
        setQuery("");
    };
    const favorites = (settings.favLangs || []).filter((code) => LANG_NAME.has(code));
    const paletteNow = palette();
    const sourceLanguages = [["auto", "Auto-detect"], ...LANGS];
    const languageOptions = (panelPage === "source" ? sourceLanguages : LANGS)
        .filter(([code, name]) => !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase()) || code.toLowerCase().includes(query.trim().toLowerCase()));
    const panelBody = panelPage === "main"
        ? [
            h(RN.Text, { key: "title", style: { color: paletteNow.text, fontSize: 22, fontWeight: "700", marginBottom: 4 } }, "Translate draft"),
            h(RN.Text, { key: "hint", style: { color: paletteNow.sub, fontSize: 14, marginBottom: 16 } }, "Translate the text already in the chat box. It stays editable and is not sent."),
            h(CustomSection, { key: "languages", title: "Languages" }, h(CustomRow, { title: "Translate from", subtitle: languageLabel(source), icon: "↗", onPress: () => { setQuery(""); setPanelPage("source"); }, trailing: h(RN.Text, { style: { color: paletteNow.sub, fontSize: 20 } }, "›") }), h(CustomRow, { title: "Translate to", subtitle: languageLabel(target), icon: "↙", last: true, onPress: () => { setQuery(""); setPanelPage("target"); }, trailing: h(RN.Text, { style: { color: paletteNow.sub, fontSize: 20 } }, "›") })),
            favorites.length ? h(RN.ScrollView, { key: "favorites", horizontal: true, showsHorizontalScrollIndicator: false, style: { marginTop: 12, marginBottom: 8 } }, ...favorites.map((code) => h(RN.Pressable, {
                key: code,
                onPress: () => setTarget(code),
                style: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, marginRight: 8, backgroundColor: code === target ? paletteNow.blurple : paletteNow.chip },
            }, h(RN.Text, { style: { color: paletteNow.text, fontSize: 14, fontWeight: "600" } }, languageLabel(code))))) : null,
            h(CustomAction, { key: "translate", title: busy ? "Translating…" : "Translate draft", disabled: busy, onPress: () => { closePanel(); run(target, source); } }),
            lastOriginal != null ? h(CustomAction, { key: "restore", title: "Restore original text", secondary: true, onPress: () => { closePanel(); restoreOriginal(); } }) : null,
            h(CustomAction, { key: "close", title: "Close", secondary: true, onPress: closePanel }),
        ]
        : [
            h(CustomAction, { key: "back", title: "‹  Back", secondary: true, onPress: () => { setPanelPage("main"); setQuery(""); } }),
            h(CustomInput, { key: "search", style: { marginVertical: 12 }, value: query, placeholder: "Search language", onChangeText: setQuery, autoCorrect: false }),
            h(RN.ScrollView, { key: "list", style: { maxHeight: 360 }, keyboardShouldPersistTaps: "handled" }, h(CustomSection, { title: panelPage === "source" ? "Translate from" : "Translate to" }, ...languageOptions.map(([code, label], index) => h(CustomRow, { key: code, title: languageLabel(code, label), subtitle: code,
                trailing: (panelPage === "source" ? source : target) === code ? h(RN.Text, { style: { color: paletteNow.blurple, fontWeight: "700" } }, "✓") : null,
                last: index === languageOptions.length - 1,
                onPress: () => { if (panelPage === "source")
                    setSource(code);
                else
                    setTarget(code); setPanelPage("main"); setQuery(""); } })))),
        ];
    return h(RN.View, { pointerEvents: "box-none", collapsable: false, style: { width: 40, height: 40, marginRight: 4, alignSelf: "center", flexShrink: 0 } }, h(RN.Animated.View, {
        onStartShouldSetResponder: () => !busy,
        onResponderTerminationRequest: () => false,
        onResponderGrant: startPress,
        onResponderRelease: finishPress,
        onResponderTerminate: cancelPress,
        hitSlop: 10,
        pressRetentionOffset: { top: 18, bottom: 18, left: 18, right: 18 },
        pointerEvents: "auto",
        collapsable: false,
        accessibilityRole: "button",
        accessibilityLabel: "Translate message",
        accessibilityHint: "Tap to arm or disarm translation; hold to translate the current draft",
        accessibilityActions: [{ name: "activate", label: "Translate" }],
        onAccessibilityTap: onPress,
        style: { width: 40, height: 40, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", opacity: busy ? 0.5 : 1, transform: [{ scale: buttonScale }] },
    }, icon), panelOpen ? h(RN.Modal, { visible: true, transparent: true, animationType: "none", onRequestClose: closePanel }, h(RN.View, { style: { flex: 1, justifyContent: "flex-end" } }, h(RN.Pressable, { style: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.52)" }, onPress: closePanel }), h(RN.Animated.View, {
        style: { maxHeight: "88%", backgroundColor: paletteNow.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28,
            transform: [{ translateY: sheetProgress.interpolate({ inputRange: [0, 1], outputRange: [620, 0] }) }] },
    }, h(RN.View, { style: { alignSelf: "center", width: 38, height: 5, borderRadius: 3, backgroundColor: paletteNow.off, marginBottom: 16 } }), panelPage === "main" ? panelBody : h(RN.ScrollView, { keyboardShouldPersistTaps: "handled" }, ...panelBody)))) : null, bulkSelectionRequest ? h(BulkMessageSelector, { key: bulkSelectionRequest.nonce, request: bulkSelectionRequest, onClose: () => { bulkSelectionRequest = null; notifyButton(); } }) : null);
}
function patchChatButton() {
    const h = React.createElement;
    const actions = findByTypeDisplayName("ChatInputActions");
    const rightActions = findByTypeDisplayName("ChatInputRightActions");
    const sendButton = findByTypeDisplayName("ChatInputSendButton");
    for (const component of [actions, rightActions]) {
        if (!component?.type)
            continue;
        unpatches.push(before("render", component.type, ([props]) => {
            if (!props || !qt.hideGiftButton)
                return;
            props.shouldShowGiftButton = false;
        }));
    }
    if (actions?.type)
        unpatches.push(after("render", actions.type, (_, ret) => {
            if (!ret)
                return ret;
            return h(RN.View, { pointerEvents: "box-none", collapsable: false, style: { flexDirection: "row", alignItems: "center", overflow: "visible" } }, ret, h(TranslateButton, { key: "qt-button-actions", position: "actions" }));
        }));
    if (sendButton?.type)
        unpatches.push(after("render", sendButton.type, (_, ret) => {
            if (!ret)
                return ret;
            return h(RN.View, { pointerEvents: "box-none", collapsable: false, style: { flexDirection: "row", alignItems: "center", overflow: "visible" } }, h(TranslateButton, { key: "qt-button-send", position: "send" }), ret);
        }));
}
function LangPicker(props) {
    const h = React.createElement;
    const settings = useQuickTranslate();
    const navigation = NavigationNative.useNavigation();
    const [query, setQuery] = React.useState("");
    const q = query.trim().toLowerCase();
    const base = props.field === "sourceOut" ? [["auto", "Auto-detect"], ...LANGS] : LANGS;
    const list = base.filter(([code, name]) => !q || name.toLowerCase().includes(q) || code.toLowerCase().includes(q));
    const choose = (code) => {
        settings.updateSettings({ [props.field]: code });
        navigation.goBack();
    };
    return h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { padding: 16, paddingBottom: 40 } }, h(CustomInput, { value: query, placeholder: "Search language", onChangeText: setQuery, autoCorrect: false, style: { marginBottom: 18 } }), h(CustomSection, { title: "Languages" }, ...list.map(([code, label], index) => h(CustomRow, { key: code, title: languageLabel(code, label), subtitle: code, last: index === list.length - 1,
        trailing: settings[props.field] === code ? h(RN.Text, { style: { color: palette().blurple, fontWeight: "700", fontSize: 18 } }, "✓") : null,
        onPress: () => choose(code) }))));
}
function FavPicker() {
    const h = React.createElement;
    const settings = useQuickTranslate();
    const [query, setQuery] = React.useState("");
    const q = query.trim().toLowerCase();
    const favs = settings.favLangs || [];
    const list = LANGS.filter(([c, n]) => !q || n.toLowerCase().includes(q) || c.toLowerCase().includes(q));
    return h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { padding: 16, paddingBottom: 40 } }, h(CustomInput, { value: query, placeholder: "Search language", onChangeText: setQuery, autoCorrect: false, style: { marginBottom: 18 } }), h(RN.Text, { style: { color: palette().sub, marginBottom: 12, fontSize: 14 } }, favs.length + " of " + MAX_FAVS + " quick languages selected"), h(CustomSection, { title: "Choose quick languages" }, ...list.map(([code, label], index) => {
        const on = favs.includes(code);
        return h(CustomRow, { key: code, title: languageLabel(code, label), subtitle: code, last: index === list.length - 1,
            trailing: h(RN.View, { style: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: on ? palette().blurple : palette().off, backgroundColor: on ? palette().blurple : "transparent", alignItems: "center", justifyContent: "center" } }, on ? h(RN.Text, { style: { color: "#FFFFFF", fontWeight: "800" } }, "✓") : null),
            onPress: () => {
                if (on)
                    settings.updateSettings({ favLangs: favs.filter(x => x !== code) });
                else if (favs.length < MAX_FAVS)
                    settings.updateSettings({ favLangs: favs.concat([code]) });
                else
                    toast("You can pick up to " + MAX_FAVS);
            } });
    })));
}
function ColorPicker() {
    const h = React.createElement;
    const settings = useQuickTranslate();
    const navigation = NavigationNative.useNavigation();
    const [value, setValue] = React.useState(String(settings.translationColor || ACCENT).toUpperCase());
    const [error, setError] = React.useState("");
    const colors = palette();
    const save = (hex) => {
        settings.updateSettings({ translationColor: hex });
        refreshTranslated();
        navigation.goBack();
    };
    const valid = HEX.test(value.trim());
    return h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { padding: 16, paddingBottom: 40 } }, h(RN.Text, { style: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: 6 } }, "Translation color"), h(RN.Text, { style: { color: colors.sub, fontSize: 14, marginBottom: 8 } }, "Choose a preset or enter a HEX color."), h(RN.Text, { style: { color: colors.sub, fontSize: 13, marginBottom: 16 } }, "Current value: " + (valid ? value.trim().toUpperCase() : "Invalid HEX")), h(CustomSection, { title: "Color presets" }, ...COLOR_PRESETS.map(([label, hex], index) => h(CustomRow, { key: hex, title: label, subtitle: hex, last: index === COLOR_PRESETS.length - 1,
        trailing: h(RN.View, { style: { flexDirection: "row", alignItems: "center", gap: 10, marginRight: 6 } }, h(RN.View, { style: { width: 20, height: 20, borderRadius: 10, backgroundColor: hex } }), value.trim().toUpperCase() === hex ? h(RN.Text, { style: { color: colors.blurple, fontWeight: "800", width: 18, textAlign: "center" } }, "✓") : h(RN.View, { style: { width: 18 } })),
        onPress: () => { setValue(hex); setError(""); } }))), h(CustomSection, { title: "Custom HEX" }, h(RN.View, { style: { padding: 14 } }, h(CustomInput, { value, placeholder: "#3366FF", autoCapitalize: "characters", autoCorrect: false, onChangeText: (next) => { setValue(next); setError(""); } }))), error ? h(RN.Text, { style: { color: "#ED4245", marginVertical: 8 } }, error) : null, h(CustomAction, { title: "Save color", disabled: !valid, onPress: () => { const hex = value.trim().toUpperCase(); if (!HEX.test(hex)) {
            setError("Enter a HEX color such as #3366FF.");
            return;
        } save(hex); } }), h(CustomAction, { title: "Use default", secondary: true, onPress: () => save(ACCENT) }));
}
function HistoryPage() {
    const h = React.createElement;
    const settings = useQuickTranslate();
    const rows = Array.isArray(settings.historyEntries) ? settings.historyEntries : [];
    const cards = rows.map((entry, index) => h(CustomSection, { key: entry.id + index, title: languageLabel(entry.source) + " → " + languageLabel(entry.target) }, h(RN.View, { style: { padding: 14 } }, h(RN.Text, { numberOfLines: 3, style: { color: palette().sub, fontSize: 13, marginBottom: 7 } }, entry.original), h(RN.Text, { style: { color: palette().text, fontSize: 15, fontWeight: "600", lineHeight: 21 } }, entry.translated), h(RN.Text, { style: { color: palette().sub, fontSize: 11, marginTop: 6 } }, (entry.provider === "deepl" ? "DeepL" : "Google") + " · " + new Date(entry.at).toLocaleString()), h(RN.View, { style: { marginTop: 7 } }, h(CustomAction, { title: "Copy translation", secondary: true, onPress: () => copyText(entry.translated) })))));
    return h(RN.ScrollView, { style: { flex: 1 }, contentContainerStyle: { padding: 16, paddingBottom: 42 } }, h(RN.View, { style: { flexDirection: "row", marginBottom: 12 } }, h(RN.View, { style: { flex: 1 } }, h(RN.Text, { style: { color: palette().text, fontSize: 22, fontWeight: "800" } }, "Translation history"), h(RN.Text, { style: { color: palette().sub, fontSize: 13, marginTop: 3 } }, rows.length + " of " + MAX_HISTORY + " saved locally")), h(RN.Text, { style: { color: palette().sub, fontSize: 19, marginTop: 2 } }, "◷")), rows.length ? null : h(RN.Text, { style: { color: palette().sub, fontSize: 14, paddingVertical: 20, textAlign: "center" } }, "No translations saved yet."), ...cards);
}
function listChannelsForGuild(guild) {
    const channels = [];
    const seen = new Set();
    const channelStore = ChannelStore;
    const add = (item) => {
        if (!item || typeof item !== "object" || item.id == null || item.name == null)
            return;
        const canonical = safe(() => channelStore.getChannel(String(item.id)), null) || item;
        const kind = canonical.type;
        if (kind != null && ![0, 5, 10, 11, 12, 15, 16].includes(kind))
            return;
        if (!canonical.guild_id && !canonical.guildId && !guild?.id)
            return;
        const id = String(canonical.id);
        if (seen.has(id))
            return;
        seen.add(id);
        channels.push({ ...canonical, id, guildId: String(guild.id), guildName: guild.name || "Server" });
    };
    const visit = (value, depth) => {
        if (!value || depth > 6)
            return;
        if (Array.isArray(value)) {
            value.forEach((item) => visit(item, depth + 1));
            return;
        }
        if (typeof value !== "object")
            return;
        add(value);
        for (const child of Object.values(value)) {
            if (child && typeof child === "object")
                visit(child, depth + 1);
        }
    };
    for (const method of ["getMutableGuildChannelsForGuild", "getGuildChannels", "getChannels", "getSortedChannels"]) {
        if (typeof channelStore?.[method] !== "function")
            continue;
        visit(safe(() => channelStore[method](String(guild.id)), null), 0);
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
    const sections = guilds.map(guild => ({
        guild,
        channels: listChannelsForGuild(guild).filter(channel => !q || String(channel.name).toLowerCase().includes(q) || String(guild.name).toLowerCase().includes(q)),
    })).filter(section => section.channels.length);
    const toggleChannel = (id) => {
        const next = selected.includes(id) ? selected.filter(x => x !== id) : selected.concat(id);
        settings.updateSettings({ autoChannelIds: next });
    };
    const dmIds = safe(() => PrivateChannelSortStore.getPrivateChannelIds?.(), []) || [];
    const dms = dmIds.map(id => safe(() => ChannelStore.getChannel(String(id)), null)).filter((channel) => channel && isDM(channel)).map((channel) => {
        const recipients = Array.isArray(channel.recipients) ? channel.recipients : [];
        const label = channel.name || recipients.map((id) => nameOf(safe(() => UserStore.getUser(String(id)), null))).join(", ") || "Direct message";
        return Object.assign({}, channel, { displayName: label });
    }).filter((channel) => !q || String(channel.displayName).toLowerCase().includes(q));
    const row = (channel, label, index, total) => {
        const id = String(channel.id);
        const marked = selected.includes(id);
        return h(CustomRow, { key: id, title: label, subtitle: channel.topic || undefined, last: index === total - 1,
            trailing: h(RN.View, { style: { width: 23, height: 23, borderRadius: 6, borderWidth: 1.5, borderColor: marked ? palette().blurple : palette().off, backgroundColor: marked ? palette().blurple : "transparent", alignItems: "center", justifyContent: "center" } }, marked ? h(RN.Text, { style: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" } }, "✓") : null),
            onPress: () => toggleChannel(id) });
    };
    return h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { padding: 16, paddingBottom: 40 } }, h(RN.Text, { style: { color: palette().sub, fontSize: 13, marginBottom: 12 } }, "Select only the channels and DMs where new incoming messages should be translated. " + selected.length + " selected."), h(CustomInput, { value: query, placeholder: "Search channels, servers, or DMs", onChangeText: setQuery, autoCorrect: false, style: { marginBottom: 16 } }), dms.length ? h(CustomSection, { title: "Direct messages" }, ...dms.map((channel, index) => row(channel, channel.displayName, index, dms.length))) : null, ...sections.map(section => h(CustomSection, { key: section.guild.id, title: section.guild.name || "Server" }, ...section.channels.map((channel, index) => row(channel, "# " + channel.name, index, section.channels.length)))), !dms.length && !sections.length ? h(RN.Text, { style: { color: palette().sub, fontSize: 14, paddingVertical: 22, textAlign: "center" } }, "No channels or DMs found. Open them once so Rain can load the channel list.") : null);
}
const TargetOutPage = () => React.createElement(LangPicker, { field: "targetOut" });
const SourceOutPage = () => React.createElement(LangPicker, { field: "sourceOut" });
const TargetInPage = () => React.createElement(LangPicker, { field: "targetIn" });
function Settings() {
    const h = React.createElement;
    const navigation = NavigationNative.useNavigation();
    const settings = useQuickTranslate();
    const go = (title, render) => navigation.push("RAIN_CUSTOM_PAGE", { title, render });
    const C = palette();
    const toggle = (title, subtitle, value, change) => h(CustomRow, {
        title, subtitle, trailing: h(CustomSwitch, { value, onChange: change }),
    });
    if (!settings._hasHydrated)
        return h(RN.View, { style: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 } }, h(RN.Text, { style: { color: C.sub, fontSize: 15 } }, "Loading saved QuickTranslate settings…"));
    return h(RN.ScrollView, { style: { flex: 1 }, contentContainerStyle: { padding: 16, paddingBottom: 42 } }, h(RN.Text, { style: { color: C.text, fontSize: 25, fontWeight: "800", marginBottom: 5 } }, "QuickTranslate"), h(RN.Text, { style: { color: C.sub, fontSize: 14, marginBottom: 23 } }, "Translation preferences for Rain"), h(CustomSection, { title: "Translation service" }, h(CustomRow, { title: "Google Translate", subtitle: "No key required · selected by default", icon: "🌐", last: settings.provider !== "deepl",
        trailing: settings.provider !== "deepl" ? h(RN.Text, { style: { color: C.blurple, fontWeight: "800", fontSize: 18 } }, "✓") : null,
        onPress: () => settings.updateSettings({ provider: "google" }) }), h(CustomRow, { title: "DeepL", subtitle: "Uses your personal API key · Google fallback", icon: "✦", last: settings.provider === "deepl",
        trailing: settings.provider === "deepl" ? h(RN.Text, { style: { color: C.blurple, fontWeight: "800", fontSize: 18 } }, "✓") : null,
        onPress: () => settings.updateSettings({ provider: "deepl" }) }), settings.provider === "deepl" ? h(RN.View, { style: { padding: 14, borderTopWidth: 1, borderTopColor: C.card2 } }, h(RN.Text, { style: { color: C.text, fontSize: 14, fontWeight: "600", marginBottom: 8 } }, "DeepL API key"), h(CustomInput, { value: settings.deeplApiKey || "", placeholder: "Paste your API key", autoCapitalize: "none", autoCorrect: false, secureTextEntry: true, onChangeText: (deeplApiKey) => settings.updateSettings({ deeplApiKey }) }), h(RN.Text, { style: { color: C.sub, fontSize: 12, marginTop: 7, lineHeight: 17 } }, "Your key is stored in this plugin’s local settings. Free API keys ending in :fx are supported.")) : null), h(CustomSection, { title: "Languages" }, h(CustomRow, { title: "Translate my messages to", subtitle: languageLabel(settings.targetOut), icon: "↗", trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => go("Translate my messages to", TargetOutPage) }), h(CustomRow, { title: "My messages are written in", subtitle: languageLabel(settings.sourceOut), icon: "↙", trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => go("My messages are written in", SourceOutPage) }), h(CustomRow, { title: "Translate messages to", subtitle: languageLabel(settings.targetIn), icon: "文", trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => go("Translate messages to", TargetInPage) }), h(CustomRow, { title: "Quick languages", subtitle: (settings.favLangs || []).length + " of " + MAX_FAVS + " selected", icon: "★", last: true, trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => go("Quick languages", FavPicker) })), h(CustomSection, { title: "Appearance" }, toggle("Immersive translation", "Show the translation below the original message. Turn off to replace its text.", !!settings.immersive, (v) => { settings.updateSettings({ immersive: v }); refreshTranslated(); }), toggle("Show detected source language", "Show a compact source → target code below the translation.", !!settings.showSourceLanguage, (v) => { settings.updateSettings({ showSourceLanguage: v }); refreshTranslated(); if (v)
        toast("Translate a message to see its source and target codes"); }), h(CustomRow, { title: "Translation color", subtitle: translationColor(), trailing: h(RN.View, { style: { flexDirection: "row", alignItems: "center" } }, h(RN.View, { style: { width: 15, height: 15, borderRadius: 5, backgroundColor: translationColor(), marginRight: 9 } }), h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›")), last: true, onPress: () => go("Translation color", ColorPicker) })), h(CustomSection, { title: "Incoming messages" }, toggle("Translate incoming messages", "Translate new messages only in the channels and DMs selected below.", !!settings.autoIncoming, (v) => settings.updateSettings({ autoIncoming: v })), toggle("Immersive incoming translations", "Show automatic translations below the original. This is separate from the main Immersive translation setting.", !!settings.autoIncomingImmersive, (v) => { settings.updateSettings({ autoIncomingImmersive: v }); refreshTranslated(); }), h(CustomRow, { title: "Automatic channels and DMs", subtitle: (settings.autoChannelIds || []).length + " selected", icon: "☷", trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), last: true, onPress: () => go("Automatic channels and DMs", AutoChannelsPage) })), h(CustomSection, { title: "History & cache" }, h(CustomRow, { title: "Translation history", subtitle: (settings.historyEntries || []).length + " saved locally", icon: "◷", trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => go("Translation history", HistoryPage) }), h(RN.View, { style: { paddingHorizontal: 13, paddingBottom: 11 } }, h(RN.Text, { style: { color: C.sub, fontSize: 12, marginTop: 10 } }, (settings.cacheEntries || []).length + " cached translations"), h(CustomAction, { title: "Clear translation cache", secondary: true, onPress: () => {
            clearTranslationCache();
        } }))), h(CustomSection, { title: "Chat composer" }, toggle("Show translate button", "Show a small translate action beside the + button.", settings.showButton !== false, (v) => { settings.updateSettings({ showButton: v }); notifyButton(); }), toggle("Keep translate active", "Tap once to keep translation enabled until you tap again.", !!settings.keepArmed, (v) => { settings.updateSettings({ keepArmed: v }); notifyButton(); }), h(CustomRow, { title: "Button position", subtitle: settings.anchor === "send" ? "Next to the Send button" : "Next to the + button", icon: "↔", trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => {
            const sheets = safe(() => findByProps("showSimpleActionSheet"), null);
            if (!sheets?.showSimpleActionSheet) {
                toast("Could not open position options");
                return;
            }
            const hide = safe(() => findByProps("openLazy", "hideActionSheet"), null);
            const savePosition = (anchor) => {
                useQuickTranslate.getState().updateSettings({ anchor });
                notifyButton();
                safe(() => hide?.hideActionSheet?.(), null);
            };
            sheets.showSimpleActionSheet({ key: "QTButtonPosition", header: { title: "Button position" }, options: [
                    { label: "Next to the + button", isMarked: settings.anchor !== "send", onPress: () => savePosition("actions") },
                    { label: "Next to the Send button", isMarked: settings.anchor === "send", onPress: () => savePosition("send") },
                ] });
        } }), toggle("Hide Gift button", "Hide Rain’s Gift button in the chat composer.", !!settings.hideGiftButton, (v) => { settings.updateSettings({ hideGiftButton: v }); toast("Restart Discord to apply this setting"); })), h(RN.Text, { style: { color: C.sub, fontSize: 12, textAlign: "center", marginTop: 1 } }, "QuickTranslate " + BUILD));
}
/* ------------------------------------------------------------------ */
/* plugin                                                              */
/* ------------------------------------------------------------------ */
const step = (name, fn) => {
    try {
        fn();
    }
    catch (e) {
        console.error(`[QuickTranslate] ${name} failed:`, e);
    }
};
function migrateSettings() {
    let stored = useQuickTranslate.getState();
    if (stored.settingsVersion < 2) {
        stored.updateSettings({ keepArmed: true, hideGiftButton: true, settingsVersion: 2 });
        stored = useQuickTranslate.getState();
    }
    if (stored.settingsVersion < 3) {
        stored.updateSettings({
            showSourceLanguage: false, autoIncoming: false, includeDMs: false,
            excludedChannelIds: [], translateDraft: false, historyEntries: [], cacheEntries: [], settingsVersion: 3,
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
            autoChannelIds: Array.isArray(stored.autoChannelIds) ? stored.autoChannelIds : [],
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
        if (!next._hasHydrated)
            return;
        if (unsubscribe)
            unsubscribe();
        migrateSettings();
        notifyButton();
    });
    unpatches.push(() => { if (unsubscribe)
        unsubscribe(); });
}
function onChannelSelect(e) {
    const id = e && e.channelId != null ? String(e.channelId) : null;
    if (id === lastChannelId)
        return;
    lastChannelId = id;
    bridge.text = "";
    bridge.change = null;
    bridge.inst = null;
    bridge.seen = 0;
    if (bulkSelectionRequest && id !== bulkSelectionRequest.channelId) {
        bulkSelectionRequest = null;
        notifyButton();
    }
    if (armed) {
        armed = null;
        notifyButton();
    }
}
exports.default = {
    name: "QuickTranslate",
    description: "Translate messages and your own text with Google Translate or DeepL.",
    id: "quicktranslate",
    version: "1.11.0",
    start() {
        renderErrors = 0;
        step("settingsHydration", waitForSettingsHydration);
        step("localData", hydrateLocalData);
        step("channel", () => {
            lastChannelId = currentChannelId();
            FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
            unpatches.push(() => FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect));
        });
        step("incomingMessages", () => {
            FluxDispatcher.subscribe("MESSAGE_CREATE", onIncomingMessage);
            unpatches.push(() => FluxDispatcher.unsubscribe("MESSAGE_CREATE", onIncomingMessage));
        });
        step("render", patchRender);
        step("actionSheet", patchActionSheet);
        step("inputCapture", installInputCapture);
        step("send", patchSend);
        step("chatButton", patchChatButton);
    },
    stop() {
        for (const u of unpatches.splice(0)) {
            try {
                u();
            }
            catch (_) { /* ignore */ }
        }
        if (renderUnpatch) {
            try {
                renderUnpatch();
            }
            catch (_) { /* ignore */ }
            renderUnpatch = null;
        }
        translations.clear();
        cacheGeneration++;
        cache.clear();
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
    },
    settings: Settings,
};
