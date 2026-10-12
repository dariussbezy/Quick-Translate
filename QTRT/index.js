"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { findAssetId } = rain.api.assets;
const { after, before, instead } = rain.api.patcher;
const { createPluginStore } = rain.api.storage;
const { showToast } = rain.api.ui.toasts;
const { findInReactTree } = rain.utils;
const { findByName, findByProps, findByStoreName, findByTypeDisplayName } = rain.metro;
const { clipboard, FluxDispatcher, NavigationNative, React, ReactNative: RN } = rain.metro.common;
const { ChannelStore, MessageStore, SelectedChannelStore, UserStore } = rain.metro.common.stores;
/* ------------------------------------------------------------------ */
/* constants + settings store                                          */
/* ------------------------------------------------------------------ */
const BUILD = "v1.5.0-rain";
const FLAG_TOGGLE = 0x04000000;
const ACCENT = "#8EA1FF";
const MAX_TRANSLATIONS = 300;
const MAX_CACHE = 200;
const MAX_FAVS = 6;
const TIMEOUT = 12000;
const PROTECT = /```[\s\S]*?```|`[^`\n]+`|<a?:\w+:\d+>|<[@#][!&]?\d+>|<t:-?\d+(?::[A-Za-z])?>|https?:\/\/[^\s<>]+/g;
const INLINE = new Set(["text", "strong", "em", "u", "s", "inlineCode"]);
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
    targetOut: "en",
    targetIn: "en",
    sourceOut: "auto",
    immersive: true,
    translationColor: ACCENT,
    showButton: true,
    translateOnSend: false,
    keepArmed: false,
    hideGiftButton: false,
    anchor: "actions",
    favLangs: ["en", "es", "fr", "de", "ro", "ru"],
});
const translations = new Map();
const cache = new Map();
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
    return h(RN.Pressable, { accessibilityRole: "switch", accessibilityState: { checked: on }, onPress: () => props.onChange(!on), hitSlop: 8, style: { width: 48, height: 29, borderRadius: 16, padding: 3, justifyContent: "center", backgroundColor: on ? C.blurple : C.off } }, h(RN.View, { style: { width: 23, height: 23, borderRadius: 12, backgroundColor: "#FFFFFF", alignSelf: on ? "flex-end" : "flex-start", elevation: 1 } }));
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
function callApi(text, tl, sl) {
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
    let m;
    if ((m = /^<a?:(\w+):\d+>$/.exec(t)))
        return ":" + m[1] + ":";
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
function translate(text, tl, sl, pretty) {
    const source = sl || "auto";
    const cacheKey = (pretty ? "p|" : "r|") + source + "|" + tl + "|" + text;
    if (cache.has(cacheKey))
        return Promise.resolve(cache.get(cacheKey));
    const { out, tokens } = protect(text);
    if (!out.replace(/§\d+§/g, "").trim())
        return Promise.resolve({ same: true, text, src: source });
    return callApi(out, tl, source).then(res => {
        const base = String(tl).toLowerCase().split("-")[0];
        const detected = String(res.src || "").toLowerCase().split("-")[0];
        const result = detected && detected === base && source === "auto"
            ? { same: true, text, src: res.src }
            : { same: false, text: restore(res.text, tokens, pretty), src: res.src };
        cache.set(cacheKey, result);
        trimMap(cache, MAX_CACHE);
        return result;
    });
}
/* ------------------------------------------------------------------ */
/* chat input bridge (reads / writes the text box)                     */
/* ------------------------------------------------------------------ */
function isChatInput(props) {
    const ph = props.placeholder;
    if (typeof ph !== "string")
        return false;
    if (/^(message|mesaj|mensaje|nachricht|messag|написать|сообщение)/i.test(ph))
        return true;
    const ch = getChannel(currentChannelId());
    if (!ch)
        return false;
    let name = ch.name;
    if (isDM(ch) && !name) {
        const rid = ch.recipients && ch.recipients[0];
        name = rid ? nameOf(safe(() => UserStore.getUser(rid), null)) : null;
    }
    return !!name && name !== "Unknown" && ph.indexOf(name) !== -1;
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
                onChangeText: (t) => { bridge.text = t; if (original)
                    original(t); },
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
const readInput = () => (Date.now() - bridge.seen < 600000 ? bridge.text : "");
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
    if (ok)
        bridge.text = text;
    return ok;
}
function showTextSheet(title, text) {
    const sheets = safe(() => findByProps("showSimpleActionSheet"), null);
    if (!sheets) {
        copyText(text);
        return;
    }
    sheets.showSimpleActionSheet({
        key: "QTResult",
        header: { title },
        options: [{ label: "Copy: " + text.slice(0, 60), onPress: () => copyText(text) }],
    });
}
function translateInput(opts) {
    const tl = opts.tl;
    const sl = opts.sl || "auto";
    const canWrite = !!(bridge.change || bridge.inst) && Date.now() - bridge.seen < 600000;
    if (!canWrite) {
        armed = { tl, sl };
        notifyButton();
        toast("Your next message will be translated to " + langName(tl) + " when you send it");
        return Promise.resolve();
    }
    const text = readInput();
    if (!text || !text.trim()) {
        toast("Type a message first");
        return Promise.resolve();
    }
    return translate(text, tl, sl, false).then(r => {
        if (r.same) {
            toast("Already in " + langName(tl));
            return;
        }
        lastOriginal = text;
        if (!writeInput(r.text))
            showTextSheet("Translation (" + langName(tl) + ")", r.text);
    }).catch((e) => {
        toast("Translation failed: " + (e && e.message ? e.message : e));
    });
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
            if ((job || qt.translateOnSend) && msg && typeof msg.content === "string" && msg.content.trim()) {
                if (job && !qt.keepArmed) {
                    armed = null;
                    notifyButton();
                }
                pending = translate(msg.content, job ? job.tl : qt.targetOut, job ? job.sl : qt.sourceOut, false).then(r => {
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
function translateMessage(message, tl) {
    const text = message && message.content;
    if (typeof text !== "string" || !text.trim()) {
        toast("This message has no text");
        return Promise.resolve();
    }
    const channelId = message.channel_id || message.channelId || currentChannelId();
    toast("Translating...");
    return translate(text, tl, "auto", true).then(r => {
        if (r.same) {
            toast("Already in " + langName(tl));
            return;
        }
        translations.set(message.id, { text: r.text, src: r.src, tl, at: Date.now(), ch: channelId });
        trimMap(translations, MAX_TRANSLATIONS);
        refreshRow(channelId, message.id);
    }).catch((e) => {
        toast("Translation failed: " + (e && e.message ? e.message : e));
    });
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
    const text = { type: "text", content: tr.text, __tr: true };
    let out;
    if (qt.immersive)
        out = base.concat([{ type: "text", content: "\n", __tr: true }], paint([text], color));
    else
        out = paint([text], color);
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
    plan.push({
        key: "qt-translate-to",
        label: "Translate to...",
        press: () => showLanguagePicker("Translate to", (code) => translateMessage(message, code)),
    });
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
function TranslateButton() {
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
    const [, tick] = React.useState(0);
    React.useEffect(() => {
        const f = () => tick((x) => x + 1);
        buttonListeners.add(f);
        return () => { buttonListeners.delete(f); if (pressTimer.current)
            clearTimeout(pressTimer.current); };
    }, []);
    if (settings.showButton === false)
        return null;
    const run = (tl, sl) => {
        if (busy)
            return;
        setBusy(true);
        let p;
        try {
            p = translateInput({ tl, sl });
        }
        catch (_) {
            p = Promise.resolve();
        }
        return p.then(() => setBusy(false), () => setBusy(false));
    };
    const iconId = findAssetId("LanguageIcon");
    const C = palette();
    const icon = iconId
        ? h(RN.Image, { source: iconId, style: { width: 24, height: 24, tintColor: armed || settings.translateOnSend ? ACCENT : C.sub } })
        : h(RN.Text, { style: { fontSize: 20, textAlign: "center", color: armed || settings.translateOnSend ? ACCENT : C.sub } }, "\uD83C\uDF10");
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
        if (settings.keepArmed) {
            armed = { tl: settings.targetOut || "en", sl: settings.sourceOut || "auto" };
            notifyButton();
            toast("Your messages will be translated until you turn this off");
            return;
        }
        run(settings.targetOut || "en", settings.sourceOut || "auto");
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
        if (pressTimer.current)
            clearTimeout(pressTimer.current);
        pressTimer.current = setTimeout(() => {
            pressTimer.current = null;
            openPanel();
        }, 450);
    };
    const finishPress = () => {
        if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
        }
        if (!didLongPress.current)
            onPress();
        didLongPress.current = false;
    };
    const cancelPress = () => {
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
            h(RN.Text, { key: "title", style: { color: paletteNow.text, fontSize: 22, fontWeight: "700", marginBottom: 4 } }, "Translate once"),
            h(RN.Text, { key: "hint", style: { color: paletteNow.sub, fontSize: 14, marginBottom: 16 } }, "Choose languages for this message only."),
            h(CustomSection, { key: "languages", title: "Languages" }, h(CustomRow, { title: "Translate from", subtitle: langName(source), icon: "↗", onPress: () => { setQuery(""); setPanelPage("source"); }, trailing: h(RN.Text, { style: { color: paletteNow.sub, fontSize: 20 } }, "›") }), h(CustomRow, { title: "Translate to", subtitle: langName(target), icon: "↙", last: true, onPress: () => { setQuery(""); setPanelPage("target"); }, trailing: h(RN.Text, { style: { color: paletteNow.sub, fontSize: 20 } }, "›") })),
            favorites.length ? h(RN.ScrollView, { key: "favorites", horizontal: true, showsHorizontalScrollIndicator: false, style: { marginTop: 12, marginBottom: 8 } }, ...favorites.map((code) => h(RN.Pressable, {
                key: code,
                onPress: () => setTarget(code),
                style: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, marginRight: 8, backgroundColor: code === target ? paletteNow.blurple : paletteNow.chip },
            }, h(RN.Text, { style: { color: paletteNow.text, fontSize: 14, fontWeight: "600" } }, langName(code))))) : null,
            h(CustomAction, { key: "translate", title: busy ? "Translating…" : "Translate", disabled: busy, onPress: () => { closePanel(); run(target, source); } }),
            lastOriginal != null ? h(CustomAction, { key: "restore", title: "Restore original text", secondary: true, onPress: () => { closePanel(); restoreOriginal(); } }) : null,
            h(CustomAction, { key: "close", title: "Close", secondary: true, onPress: closePanel }),
        ]
        : [
            h(CustomAction, { key: "back", title: "‹  Back", secondary: true, onPress: () => { setPanelPage("main"); setQuery(""); } }),
            h(CustomInput, { key: "search", style: { marginVertical: 12 }, value: query, placeholder: "Search language", onChangeText: setQuery, autoCorrect: false }),
            h(RN.ScrollView, { key: "list", style: { maxHeight: 360 }, keyboardShouldPersistTaps: "handled" }, h(CustomSection, { title: panelPage === "source" ? "Translate from" : "Translate to" }, ...languageOptions.map(([code, label], index) => h(CustomRow, { key: code, title: label, subtitle: code,
                trailing: (panelPage === "source" ? source : target) === code ? h(RN.Text, { style: { color: paletteNow.blurple, fontWeight: "700" } }, "✓") : null,
                last: index === languageOptions.length - 1,
                onPress: () => { if (panelPage === "source")
                    setSource(code);
                else
                    setTarget(code); setPanelPage("main"); setQuery(""); } })))),
        ];
    return h(RN.View, { pointerEvents: "box-none", collapsable: false, style: { marginRight: 4, zIndex: 10, elevation: 10 } }, h(RN.View, {
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
        accessibilityHint: "Tap to translate; hold to choose languages",
        accessibilityActions: [{ name: "activate", label: "Translate" }],
        onAccessibilityTap: onPress,
        style: { width: 44, height: 44, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", opacity: busy ? 0.5 : 1 },
    }, icon), panelOpen ? h(RN.Modal, { visible: true, transparent: true, animationType: "slide", onRequestClose: closePanel }, h(RN.View, { style: { flex: 1, justifyContent: "flex-end" } }, h(RN.Pressable, { style: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.52)" }, onPress: closePanel }), h(RN.View, {
        style: { maxHeight: "88%", backgroundColor: paletteNow.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28 },
    }, h(RN.View, { style: { alignSelf: "center", width: 38, height: 5, borderRadius: 3, backgroundColor: paletteNow.off, marginBottom: 16 } }), panelPage === "main" ? panelBody : h(RN.ScrollView, { keyboardShouldPersistTaps: "handled" }, ...panelBody)))) : null);
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
            if (qt.anchor !== "actions" || qt.showButton === false)
                return ret;
            return h(RN.View, { pointerEvents: "box-none", collapsable: false, style: { flexDirection: "row", alignItems: "center", overflow: "visible" } }, ret, h(TranslateButton, { key: "qt-button" }));
        }));
    if (sendButton?.type)
        unpatches.push(after("render", sendButton.type, (_, ret) => {
            if (!ret || qt.anchor !== "send" || qt.showButton === false)
                return ret;
            return h(RN.View, { pointerEvents: "box-none", collapsable: false, style: { flexDirection: "row", alignItems: "center", overflow: "visible" } }, h(TranslateButton, { key: "qt-button" }), ret);
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
    return h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { padding: 16, paddingBottom: 40 } }, h(CustomInput, { value: query, placeholder: "Search language", onChangeText: setQuery, autoCorrect: false, style: { marginBottom: 18 } }), h(CustomSection, { title: "Languages" }, ...list.map(([code, label], index) => h(CustomRow, { key: code, title: label, subtitle: code, last: index === list.length - 1,
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
        return h(CustomRow, { key: code, title: label, subtitle: code, last: index === list.length - 1,
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
    const preview = valid ? value.trim().toUpperCase() : "transparent";
    return h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { padding: 16, paddingBottom: 40 } }, h(RN.Text, { style: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: 6 } }, "Translation color"), h(RN.Text, { style: { color: colors.sub, fontSize: 14, marginBottom: 16 } }, "Choose a preset or enter a HEX color."), h(CustomSection, { title: "Preview" }, h(RN.View, { style: { minHeight: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: 15, gap: 12 } }, h(RN.View, { style: { width: 30, height: 30, borderRadius: 15, backgroundColor: preview, borderWidth: 1, borderColor: colors.off } }), h(RN.Text, { style: { color: colors.text, fontWeight: "700", fontSize: 16 } }, valid ? value.trim().toUpperCase() : "Enter a valid HEX color"))), h(CustomSection, { title: "Color presets" }, ...COLOR_PRESETS.map(([label, hex], index) => h(CustomRow, { key: hex, title: label, subtitle: hex, last: index === COLOR_PRESETS.length - 1,
        trailing: h(RN.View, { style: { flexDirection: "row", alignItems: "center", gap: 10, marginRight: 6 } }, h(RN.View, { style: { width: 20, height: 20, borderRadius: 10, backgroundColor: hex } }), value.trim().toUpperCase() === hex ? h(RN.Text, { style: { color: colors.blurple, fontWeight: "800", width: 18, textAlign: "center" } }, "✓") : h(RN.View, { style: { width: 18 } })),
        onPress: () => { setValue(hex); setError(""); } }))), h(CustomSection, { title: "Custom HEX" }, h(RN.View, { style: { padding: 14 } }, h(CustomInput, { value, placeholder: "#3366FF", autoCapitalize: "characters", autoCorrect: false, onChangeText: (next) => { setValue(next); setError(""); } }))), error ? h(RN.Text, { style: { color: "#ED4245", marginVertical: 8 } }, error) : null, h(CustomAction, { title: "Save color", disabled: !valid, onPress: () => { const hex = value.trim().toUpperCase(); if (!HEX.test(hex)) {
            setError("Enter a HEX color such as #3366FF.");
            return;
        } save(hex); } }), h(CustomAction, { title: "Use default", secondary: true, onPress: () => save(ACCENT) }));
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
    return h(RN.ScrollView, { style: { flex: 1 }, contentContainerStyle: { padding: 16, paddingBottom: 42 } }, h(RN.Text, { style: { color: C.text, fontSize: 24, fontWeight: "800", marginBottom: 5 } }, "QuickTranslate"), h(RN.Text, { style: { color: C.sub, fontSize: 14, marginBottom: 23 } }, "Translation preferences for Rain"), h(CustomSection, { title: "Languages" }, h(CustomRow, { title: "Translate my messages to", subtitle: langName(settings.targetOut), icon: "↗", trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => go("Translate my messages to", TargetOutPage) }), h(CustomRow, { title: "My messages are written in", subtitle: langName(settings.sourceOut), icon: "↙", trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => go("My messages are written in", SourceOutPage) }), h(CustomRow, { title: "Translate messages to", subtitle: langName(settings.targetIn), icon: "文", trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => go("Translate messages to", TargetInPage) }), h(CustomRow, { title: "Quick languages", subtitle: (settings.favLangs || []).length + " of " + MAX_FAVS + " selected", icon: "★", last: true, trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => go("Quick languages", FavPicker) })), h(CustomSection, { title: "Appearance" }, toggle("Immersive translation", "Show the translation below the original message. Turn off to replace its text.", !!settings.immersive, (v) => { settings.updateSettings({ immersive: v }); refreshTranslated(); }), h(CustomRow, { title: "Translation color", subtitle: translationColor(), icon: "●", trailing: h(RN.View, { style: { width: 22, height: 22, borderRadius: 11, backgroundColor: translationColor(), marginRight: 8 } }), last: true, onPress: () => go("Translation color", ColorPicker) })), h(CustomSection, { title: "Chat composer" }, toggle("Show translate button", "Show a small translate action beside the + button.", settings.showButton !== false, (v) => { settings.updateSettings({ showButton: v }); notifyButton(); }), toggle("Translate on send", "Translate each message right before it is sent.", !!settings.translateOnSend, (v) => { settings.updateSettings({ translateOnSend: v }); notifyButton(); }), toggle("Keep translate active", "Tap once to keep translation enabled until you tap again.", !!settings.keepArmed, (v) => { settings.updateSettings({ keepArmed: v }); notifyButton(); }), h(CustomRow, { title: "Button position", subtitle: settings.anchor === "send" ? "Next to the Send button" : "Next to the + button", trailing: h(RN.Text, { style: { color: C.sub, fontSize: 21 } }, "›"), onPress: () => { settings.updateSettings({ anchor: settings.anchor === "send" ? "actions" : "send" }); notifyButton(); } }), toggle("Hide Gift button", "Hide Rain’s Gift button in the chat composer.", !!settings.hideGiftButton, (v) => { settings.updateSettings({ hideGiftButton: v }); toast("Restart Discord to apply this setting"); })), h(RN.Text, { style: { color: C.sub, fontSize: 12, textAlign: "center", marginTop: 1 } }, "QuickTranslate " + BUILD));
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
function onChannelSelect(e) {
    const id = e && e.channelId != null ? String(e.channelId) : null;
    if (id === lastChannelId)
        return;
    lastChannelId = id;
    if (armed) {
        armed = null;
        notifyButton();
    }
}
exports.default = {
    name: "QuickTranslate",
    description: "Translate messages and your own text with Google Translate. Chat bar button, translate on send, quick languages.",
    id: "quicktranslate",
    version: "1.5.0",
    start() {
        renderErrors = 0;
        const stored = useQuickTranslate.getState();
        const migration = { anchor: "actions" };
        if (stored.hideGiftButton === undefined)
            migration.hideGiftButton = false;
        const missing = Object.fromEntries(Object.entries(migration).filter(([key]) => stored[key] === undefined));
        if (Object.keys(missing).length)
            stored.updateSettings(missing);
        step("channel", () => {
            lastChannelId = currentChannelId();
            FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
            unpatches.push(() => FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect));
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
        cache.clear();
        bridge.text = "";
        bridge.change = null;
        bridge.inst = null;
        armed = null;
        lastOriginal = null;
    },
    settings: Settings,
};
