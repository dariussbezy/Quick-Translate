var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
const { findAssetId } = rain.api.assets;
const { after, before, instead } = rain.api.patcher;
const { createPluginStore } = rain.api.storage;
const { Search, SettingsTextInput } = rain.api.ui.components;
const { showToast } = rain.api.ui.toasts;
const { findInReactTree } = rain.utils;
const { findByName, findByProps, findByStoreName, findByTypeDisplayName } = rain.metro;
const { clipboard, FluxDispatcher, NavigationNative, React, ReactNative: RN } = rain.metro.common;
const { IconButton, Stack, TableCheckboxRow, TableRadioGroup, TableRadioRow, TableRow, TableRowGroup, TableSwitchRow } = rain.metro.common.components;
const { ChannelStore, MessageStore, SelectedChannelStore, UserStore } = rain.metro.common.stores;
const BUILD = "v1.3.0-rain";
const FLAG_TOGGLE = 67108864;
const ACCENT = "#8EA1FF";
const MAX_TRANSLATIONS = 300;
const MAX_CACHE = 200;
const MAX_FAVS = 6;
const TIMEOUT = 12e3;
const PROTECT = /```[\s\S]*?```|`[^`\n]+`|<a?:\w+:\d+>|<[@#][!&]?\d+>|<t:-?\d+(?::[A-Za-z])?>|https?:\/\/[^\s<>]+/g;
const INLINE = /* @__PURE__ */ new Set(["text", "strong", "em", "u", "s", "inlineCode"]);
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
  ["eo", "Esperanto"]
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
  ["Gray", "#80848E"]
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
  favLangs: ["en", "es", "fr", "de", "ro", "ru"]
});
const translations = /* @__PURE__ */ new Map();
const cache = /* @__PURE__ */ new Map();
const unpatches = [];
const bridge = { text: "", change: null, inst: null, seen: 0 };
const refWrappers = /* @__PURE__ */ new WeakMap();
const buttonListeners = /* @__PURE__ */ new Set();
let armed = null;
let lastChannelId = null;
let lastOriginal = null;
let renderErrors = 0;
let renderUnpatch = null;
let ThemeStore;
const toast = (t) => {
  try {
    showToast(t);
  } catch (_) {
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
const langName = (code) => code === "auto" ? "Auto-detect" : LANG_NAME.get(code) || code;
const notifyButton = () => buttonListeners.forEach((f) => {
  try {
    f();
  } catch (_) {
  }
});
const getMessage = (c, id) => safe(() => MessageStore.getMessage(c, id) || null, null);
const getChannel = (id) => safe(() => id ? ChannelStore.getChannel(id) : null, null);
const isDM = (ch) => !!ch && (ch.type === 1 || ch.type === 3);
const nameOf = (u) => u ? u.globalName || u.global_name || u.username || "Unknown" : "Unknown";
function currentChannelId() {
  return safe(() => {
    var _a, _b, _c, _d;
    return (_d = (_c = (_a = SelectedChannelStore.getChannelId) == null ? void 0 : _a.call(SelectedChannelStore)) != null ? _c : (_b = SelectedChannelStore.getCurrentlySelectedChannelId) == null ? void 0 : _b.call(SelectedChannelStore)) != null ? _d : null;
  }, null);
}
function palette() {
  const light = safe(() => {
    ThemeStore = ThemeStore || findByStoreName("ThemeStore");
    return !!ThemeStore && ThemeStore.theme === "light";
  }, false);
  return light ? { text: "#060607", sub: "#5C5E66", bg: "#FFFFFF", card: "#F2F3F5", blurple: "#5865F2", card2: "rgba(0,0,0,0.045)", chip: "rgba(0,0,0,0.07)", press: "rgba(0,0,0,0.06)", off: "#B5BAC1" } : { text: "#FFFFFF", sub: "#B5BAC1", bg: "#1E1F22", card: "#2B2D31", blurple: "#5865F2", card2: "rgba(255,255,255,0.06)", chip: "rgba(255,255,255,0.10)", press: "rgba(255,255,255,0.07)", off: "#4E5058" };
}
const translationColor = () => HEX.test(String(qt.translationColor || "")) ? String(qt.translationColor).toUpperCase() : ACCENT;
function copyText(text) {
  try {
    clipboard.setString(text);
    toast("Copied");
  } catch (_) {
    toast("Could not copy");
  }
}
function fetchT(url, opts) {
  let timer;
  const clear = () => clearTimeout(timer);
  return Promise.race([
    fetch(url, opts),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out")), TIMEOUT);
    })
  ]).then((res) => {
    clear();
    return res;
  }, (err) => {
    clear();
    throw err;
  });
}
function callApi(text, tl, sl) {
  const params = "client=gtx&dt=t&sl=" + encodeURIComponent(sl || "auto") + "&tl=" + encodeURIComponent(tl);
  const base = "https://translate.googleapis.com/translate_a/single?" + params;
  const req = text.length < 1200 ? fetchT(base + "&q=" + encodeURIComponent(text)) : fetchT(base, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: "q=" + encodeURIComponent(text)
  });
  return req.then((res) => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then((json) => {
    const segments = Array.isArray(json) && Array.isArray(json[0]) ? json[0] : [];
    const out = segments.map((s) => s && s[0] || "").join("");
    if (!out && text.trim()) throw new Error("Empty response");
    return { text: out, src: Array.isArray(json) && typeof json[2] === "string" && json[2] || sl };
  });
}
function prettyToken(t) {
  let m;
  if (m = /^<a?:(\w+):\d+>$/.exec(t)) return ":" + m[1] + ":";
  if (m = /^<@!?(\d+)>$/.exec(t)) return "@" + nameOf(safe(() => UserStore.getUser(m[1]), null));
  if (m = /^<#(\d+)>$/.exec(t)) return "#" + ((getChannel(m[1]) || {}).name || "channel");
  if (/^<@&\d+>$/.test(t)) return "@role";
  if (/^<t:/.test(t)) return "";
  return t;
}
function protect(text) {
  const tokens = [];
  const out = text.replace(PROTECT, (m) => {
    tokens.push(m);
    return "\xA7" + (tokens.length - 1) + "\xA7";
  });
  return { out, tokens };
}
function restore(text, tokens, pretty) {
  const used = /* @__PURE__ */ new Set();
  let out = text.replace(/§\s*(\d+)\s*§/g, (m, i) => {
    const t = tokens[Number(i)];
    if (t === void 0) return m;
    used.add(Number(i));
    return pretty ? prettyToken(t) : t;
  });
  if (!pretty) {
    const missing = tokens.filter((_, i) => !used.has(i));
    if (missing.length) out += " " + missing.join(" ");
  }
  return out;
}
function translate(text, tl, sl, pretty) {
  const source = sl || "auto";
  const cacheKey = (pretty ? "p|" : "r|") + source + "|" + tl + "|" + text;
  if (cache.has(cacheKey)) return Promise.resolve(cache.get(cacheKey));
  const { out, tokens } = protect(text);
  if (!out.replace(/§\d+§/g, "").trim()) return Promise.resolve({ same: true, text, src: source });
  return callApi(out, tl, source).then((res) => {
    const base = String(tl).toLowerCase().split("-")[0];
    const detected = String(res.src || "").toLowerCase().split("-")[0];
    const result = detected && detected === base && source === "auto" ? { same: true, text, src: res.src } : { same: false, text: restore(res.text, tokens, pretty), src: res.src };
    cache.set(cacheKey, result);
    trimMap(cache, MAX_CACHE);
    return result;
  });
}
function isChatInput(props) {
  const ph = props.placeholder;
  if (typeof ph !== "string") return false;
  if (/^(message|mesaj|mensaje|nachricht|messag|написать|сообщение)/i.test(ph)) return true;
  const ch = getChannel(currentChannelId());
  if (!ch) return false;
  let name = ch.name;
  if (isDM(ch) && !name) {
    const rid = ch.recipients && ch.recipients[0];
    name = rid ? nameOf(safe(() => UserStore.getUser(rid), null)) : null;
  }
  return !!name && name !== "Unknown" && ph.indexOf(name) !== -1;
}
function installInputCapture() {
  const TI = RN.TextInput;
  if (!TI || typeof TI.render !== "function") return;
  unpatches.push(before("render", TI, (args) => {
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
        }
      });
      const ref = args[1];
      let wrapped = ref && typeof ref === "object" ? refWrappers.get(ref) : null;
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
    }
  }));
}
const readInput = () => Date.now() - bridge.seen < 6e5 ? bridge.text : "";
function writeInput(text) {
  let ok = false;
  if (bridge.change) {
    try {
      bridge.change(text);
      ok = true;
    } catch (_) {
    }
  }
  if (bridge.inst && typeof bridge.inst.setNativeProps === "function") {
    try {
      bridge.inst.setNativeProps({ text });
      ok = true;
    } catch (_) {
    }
  }
  if (ok) bridge.text = text;
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
    options: [{ label: "Copy: " + text.slice(0, 60), onPress: () => copyText(text) }]
  });
}
function translateInput(opts) {
  const tl = opts.tl;
  const sl = opts.sl || "auto";
  const canWrite = !!(bridge.change || bridge.inst) && Date.now() - bridge.seen < 6e5;
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
  return translate(text, tl, sl, false).then((r) => {
    if (r.same) {
      toast("Already in " + langName(tl));
      return;
    }
    lastOriginal = text;
    if (!writeInput(r.text)) showTextSheet("Translation (" + langName(tl) + ")", r.text);
  }).catch((e) => {
    toast("Translation failed: " + (e && e.message ? e.message : e));
  });
}
function restoreOriginal() {
  if (lastOriginal == null) {
    toast("Nothing to restore");
    return;
  }
  if (writeInput(lastOriginal)) lastOriginal = null;
  else toast("Could not write to the chat box");
}
function patchSend() {
  const Messages = findByProps("sendMessage", "receiveMessage");
  if (!Messages) return;
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
        pending = translate(msg.content, job ? job.tl : qt.targetOut, job ? job.sl : qt.sourceOut, false).then((r) => {
          if (!r.same) args[1] = Object.assign({}, msg, { content: r.text });
        });
      }
    } catch (_) {
      toast("Translation failed, sent the original message");
    }
    if (!pending) return orig(...args);
    return pending.catch(() => {
      toast("Translation failed, sent the original message");
    }).then(() => orig(...args));
  }));
}
function refreshRow(channelId, id) {
  const msg = getMessage(channelId, id);
  if (!msg) return;
  const guildId = safe(() => getChannel(channelId).guild_id, null);
  setTimeout(() => {
    try {
      FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        guildId,
        message: { id, channel_id: channelId, guild_id: guildId, flags: (msg.flags | 0) ^ FLAG_TOGGLE }
      });
    } catch (_) {
    }
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
  return translate(text, tl, "auto", true).then((r) => {
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
  translations.forEach((t, id) => {
    if (t.ch) refreshRow(t.ch, id);
  });
}
function showOriginal(message) {
  const channelId = message.channel_id || message.channelId || currentChannelId();
  translations.delete(message.id);
  refreshRow(channelId, message.id);
}
function paint(nodes, color) {
  if (!color) return nodes;
  return [{
    type: "link",
    target: "usernameOnClick",
    context: { username: "", usernameOnClick: { action: "0", userId: "0", linkColor: color, messageChannelId: "0" } },
    content: nodes.filter((n) => n && INLINE.has(n.type))
  }];
}
function stripOurs(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n && n.__tr) continue;
    if (n && Array.isArray(n.content)) {
      const inner = stripOurs(n.content);
      if (!inner.length && n.content.length) continue;
      out.push(inner.length === n.content.length ? n : Object.assign({}, n, { content: inner }));
    } else out.push(n);
  }
  return out;
}
function decorate(row, input) {
  const m = row && row.message;
  if (!m) return;
  const rowType = input && input.rowType !== void 0 ? input.rowType : row.rowType;
  if (rowType !== 1) return;
  const tr = translations.get(m.id);
  const ours = m.__trOut && m.content === m.__trOut;
  if (!tr) {
    if (ours) m.content = m.__trBase;
    else if (Array.isArray(m.content)) {
      const clean = stripOurs(m.content);
      if (clean.length !== m.content.length) m.content = clean;
    }
    return;
  }
  const base = ours ? m.__trBase : Array.isArray(m.content) ? stripOurs(m.content) : null;
  if (!Array.isArray(base)) return;
  const pc = RN.processColor;
  const color = pc ? pc(translationColor()) : null;
  const text = { type: "text", content: tr.text, __tr: true };
  let out;
  if (qt.immersive) out = base.concat([{ type: "text", content: "\n", __tr: true }], paint([text], color));
  else out = paint([text], color);
  if (!out.length) return;
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
    }
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
    } catch (_) {
      onRenderError();
    }
  });
}
function messagePlan(message) {
  if (!message || !message.id || typeof message.content !== "string" || !message.content.trim()) return null;
  const plan = [];
  if (translations.has(message.id)) {
    plan.push({ key: "qt-original", label: "Show original message", press: () => showOriginal(message) });
  } else {
    plan.push({ key: "qt-translate", label: "Translate to " + langName(qt.targetIn), press: () => translateMessage(message, qt.targetIn) });
  }
  plan.push({
    key: "qt-translate-to",
    label: "Translate to...",
    press: () => showLanguagePicker("Translate to", (code) => translateMessage(message, code))
  });
  return plan;
}
function hideLanguageSheet() {
  try {
    findByProps("openLazy", "hideActionSheet").hideActionSheet();
  } catch (_) {
  }
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
      }
    }));
    if (includeMore) options.push({
      label: "Show more",
      onPress: () => {
        hideLanguageSheet();
        setTimeout(() => showSheet(LANGS, key + "All", false), 300);
      }
    });
    sheets.showSimpleActionSheet({ key, header: { title }, options });
  };
  const favoriteLanguages = favorites.map((code) => [code, langName(code)]);
  setTimeout(() => showSheet(favorites.length ? favoriteLanguages : LANGS, "QTTranslateTo", favorites.length > 0), 300);
}
function addRows(tree, plan, lazySheet) {
  var _a, _b;
  const container = findInReactTree(tree, (x) => {
    var _a2, _b2;
    return Array.isArray(x) && ((_b2 = (_a2 = x[0]) == null ? void 0 : _a2.type) == null ? void 0 : _b2.name) === "ActionSheetRowGroup";
  });
  if (!container || !container[1]) {
    console.log("[QuickTranslate] could not find the action sheet group");
    return;
  }
  const group = container[1];
  const children = (_a = group.props) == null ? void 0 : _a.children;
  if (!Array.isArray(children) || !children[0]) return;
  if (children.some((c) => typeof (c == null ? void 0 : c.key) === "string" && c.key.startsWith("qt-"))) return;
  const tpl = children[0];
  const Row = tpl.type;
  const iconId = findAssetId("LanguageIcon");
  const tplIcon = (_b = tpl.props) == null ? void 0 : _b.icon;
  const icon = tplIcon ? {
    $$typeof: tplIcon.$$typeof,
    type: tplIcon.type,
    key: null,
    ref: null,
    props: {
      IconComponent: () => React.createElement(RN.Image, {
        resizeMode: "cover",
        style: { width: 24, height: 24, tintColor: palette().text },
        source: iconId
      })
    }
  } : void 0;
  const rows = plan.map((item) => React.createElement(Row, {
    key: item.key,
    label: item.label,
    icon,
    onPress: () => {
      try {
        lazySheet.hideActionSheet();
      } catch (_) {
      }
      item.press();
    }
  }));
  const copyIndex = children.findIndex((c) => {
    var _a2, _b2, _c, _d, _e, _f, _g, _h;
    return ((_d = (_c = (_b2 = (_a2 = c == null ? void 0 : c.props) == null ? void 0 : _a2.label) == null ? void 0 : _b2.toUpperCase) == null ? void 0 : _c.call(_b2)) == null ? void 0 : _d.includes("COPY")) || ((_h = (_g = (_f = (_e = c == null ? void 0 : c.props) == null ? void 0 : _e.message) == null ? void 0 : _f.toUpperCase) == null ? void 0 : _g.call(_f)) == null ? void 0 : _h.includes("COPY"));
  });
  if (copyIndex !== -1) children.splice(copyIndex, 0, ...rows);
  else children.push(...rows);
}
function patchActionSheet() {
  const lazySheet = findByProps("openLazy", "hideActionSheet");
  if (!lazySheet) return;
  unpatches.push(before("openLazy", lazySheet, ([component, key, ctx]) => {
    try {
      if (key !== "MessageLongPressActionSheet" || !component || typeof component.then !== "function") return;
      const plan = messagePlan(ctx && ctx.message);
      if (!plan) return;
      component.then((instance) => {
        const un = after("default", instance, (_, tree) => {
          React.useEffect(() => () => {
            un();
          }, []);
          try {
            addRows(tree, plan, lazySheet);
          } catch (e) {
            console.error(e);
          }
        });
      });
    } catch (_) {
    }
  }));
}
function TranslateButton() {
  const h = React.createElement;
  const settings = useQuickTranslate();
  const [busy, setBusy] = React.useState(false);
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const f = () => tick((x) => x + 1);
    buttonListeners.add(f);
    return () => {
      buttonListeners.delete(f);
    };
  }, []);
  if (settings.showButton === false) return null;
  const run = (tl, sl) => {
    if (busy) return;
    setBusy(true);
    let p;
    try {
      p = translateInput({ tl, sl });
    } catch (_) {
      p = Promise.resolve();
    }
    return p.then(() => setBusy(false), () => setBusy(false));
  };
  const iconId = findAssetId("LanguageIcon");
  const C = palette();
  const icon = iconId ? h(RN.Image, { source: iconId, style: { width: 24, height: 24, tintColor: armed || settings.translateOnSend ? ACCENT : C.sub } }) : h(RN.Text, { style: { fontSize: 20, textAlign: "center", color: armed || settings.translateOnSend ? ACCENT : C.sub } }, "\u{1F310}");
  const onPress = () => {
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
  return h(
    RN.View,
    { style: { marginRight: 6 } },
    IconButton ? h(IconButton, { icon, label: "Translate", onPress, disabled: busy, size: "sm", variant: "tertiary", style: { width: 40, height: 40, borderRadius: 0, backgroundColor: "transparent", marginRight: 6, opacity: busy ? 0.5 : 1 } }) : h(RN.Pressable, {
      onPress,
      accessibilityRole: "button",
      accessibilityLabel: "Translate message",
      disabled: busy,
      style: { width: 40, height: 40, backgroundColor: "transparent", alignItems: "center", justifyContent: "center", opacity: busy ? 0.5 : 1 }
    }, icon)
  );
}
function patchChatButton() {
  const ChatInputActions = findByTypeDisplayName("ChatInputActions");
  if (!(ChatInputActions == null ? void 0 : ChatInputActions.type)) {
    console.log("[QuickTranslate] ChatInputActions not found");
    return;
  }
  unpatches.push(after("render", ChatInputActions.type, (_, ret) => {
    if (qt.showButton === false || !ret) return ret;
    const button = React.createElement(TranslateButton, { key: "qt-button" });
    return React.createElement(RN.View, { style: { flexDirection: "row", alignItems: "center" } }, ret, button);
  }));
}
function LangPicker(props) {
  const h = React.createElement;
  const settings = useQuickTranslate();
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const base = props.field === "sourceOut" ? [["auto", "Auto-detect"], ...LANGS] : LANGS;
  const list = base.filter(([c, n]) => !q || n.toLowerCase().includes(q) || c.toLowerCase().includes(q));
  return h(
    RN.ScrollView,
    { style: { flex: 1 }, contentContainerStyle: { paddingBottom: 38 } },
    h(Search, { style: { padding: 15 }, placeholder: "Search language", onChangeText: setQuery, isRound: false }),
    h(
      Stack,
      { style: { paddingHorizontal: 12 }, spacing: 24 },
      h(TableRadioGroup, {
        title: "Select language",
        value: settings[props.field],
        onChange: (value) => settings.updateSettings({ [props.field]: value })
      }, ...list.map(([code, label]) => h(TableRadioRow, { key: code, label, subLabel: code, value: code })))
    )
  );
}
function FavPicker() {
  const h = React.createElement;
  const settings = useQuickTranslate();
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const favs = settings.favLangs || [];
  const list = LANGS.filter(([c, n]) => !q || n.toLowerCase().includes(q) || c.toLowerCase().includes(q));
  return h(
    RN.ScrollView,
    { style: { flex: 1 }, contentContainerStyle: { paddingBottom: 38 } },
    h(Search, { style: { padding: 15 }, placeholder: "Search language", onChangeText: setQuery, isRound: false }),
    h(
      Stack,
      { style: { paddingHorizontal: 12 }, spacing: 24 },
      h(
        TableRowGroup,
        { title: "Pick up to " + MAX_FAVS },
        ...list.map(([code, label]) => {
          const on = favs.includes(code);
          return h(TableCheckboxRow, {
            key: code,
            label,
            subLabel: code,
            checked: on,
            onPress: () => {
              if (on) settings.updateSettings({ favLangs: favs.filter((x) => x !== code) });
              else if (favs.length < MAX_FAVS) settings.updateSettings({ favLangs: favs.concat([code]) });
              else toast("You can pick up to " + MAX_FAVS);
            }
          });
        })
      )
    )
  );
}
function ColorPicker() {
  const h = React.createElement;
  const settings = useQuickTranslate();
  const current = HEX.test(String(settings.translationColor || "")) ? String(settings.translationColor).toUpperCase() : ACCENT;
  const [value, setValue] = React.useState(current);
  return h(
    RN.ScrollView,
    { style: { flex: 1 }, contentContainerStyle: { paddingBottom: 38 } },
    h(
      Stack,
      { style: { paddingVertical: 12, paddingHorizontal: 12 }, spacing: 24 },
      h(
        TableRowGroup,
        { title: "Basic colors" },
        ...COLOR_PRESETS.map(([label, hex]) => h(TableRow, {
          key: hex,
          label,
          subLabel: hex,
          icon: h(RN.View, { style: { width: 20, height: 20, borderRadius: 10, backgroundColor: hex } }),
          trailing: current === hex ? h(RN.Text, { style: { color: palette().sub } }, "Selected") : void 0,
          onPress: () => {
            setValue(hex);
            settings.updateSettings({ translationColor: hex });
            refreshTranslated();
          }
        }))
      ),
      h(
        TableRowGroup,
        { title: "Custom HEX (example: #3366FF)" },
        h(SettingsTextInput, {
          placeholder: "#3366FF",
          value,
          onChange: (v) => {
            setValue(v);
            const hex = String(v).trim().toUpperCase();
            if (HEX.test(hex)) {
              settings.updateSettings({ translationColor: hex });
              refreshTranslated();
            }
          }
        })
      )
    )
  );
}
const TargetOutPage = () => React.createElement(LangPicker, { field: "targetOut" });
const SourceOutPage = () => React.createElement(LangPicker, { field: "sourceOut" });
const TargetInPage = () => React.createElement(LangPicker, { field: "targetIn" });
function Settings() {
  const h = React.createElement;
  const navigation = NavigationNative.useNavigation();
  const settings = useQuickTranslate();
  const langIcon = h(TableRow.Icon, { source: findAssetId("LanguageIcon") });
  const go = (title, render) => navigation.push("RAIN_CUSTOM_PAGE", { title, render });
  const arrow = () => h(TableRow.Arrow, null);
  return h(
    RN.ScrollView,
    { style: { flex: 1 }, contentContainerStyle: { paddingBottom: 38 } },
    h(
      Stack,
      { style: { paddingVertical: 24, paddingHorizontal: 12 }, spacing: 24 },
      h(
        TableRowGroup,
        { title: "Languages" },
        h(TableRow, { label: "Translate my messages to", subLabel: langName(settings.targetOut), icon: langIcon, trailing: arrow, onPress: () => go("Translate my messages to", TargetOutPage) }),
        h(TableRow, { label: "My messages are written in", subLabel: langName(settings.sourceOut), icon: langIcon, trailing: arrow, onPress: () => go("My messages are written in", SourceOutPage) }),
        h(TableRow, { label: "Translate messages to", subLabel: langName(settings.targetIn), icon: langIcon, trailing: arrow, onPress: () => go("Translate messages to", TargetInPage) }),
        h(TableRow, { label: "Quick languages", subLabel: (settings.favLangs || []).length + " selected", icon: langIcon, trailing: arrow, onPress: () => go("Quick languages", FavPicker) })
      ),
      h(
        TableRowGroup,
        { title: "Display" },
        h(TableSwitchRow, {
          label: "Immersive translation",
          subLabel: "Show the translation below the original message. Off replaces the original text",
          value: !!settings.immersive,
          onValueChange: (v) => {
            settings.updateSettings({ immersive: v });
            refreshTranslated();
          }
        }),
        h(TableRow, { label: "Translation color", subLabel: translationColor(), trailing: arrow, onPress: () => go("Translation color", ColorPicker) })
      ),
      h(
        TableRowGroup,
        { title: "Chat bar" },
        h(TableSwitchRow, {
          label: "Show translate button in chat box",
          subLabel: "Turn off to only translate from the message long-press menu. Restart Discord to apply",
          value: settings.showButton !== false,
          onValueChange: (v) => {
            settings.updateSettings({ showButton: v });
            notifyButton();
          }
        }),
        h(TableSwitchRow, {
          label: "Translate on send",
          subLabel: "Translate every message right before it is sent",
          value: !!settings.translateOnSend,
          onValueChange: (v) => {
            settings.updateSettings({ translateOnSend: v });
            notifyButton();
          }
        }),
        h(TableSwitchRow, {
          label: "Keep translate button active",
          subLabel: "Tapping the button keeps translation on until you tap it again",
          value: !!settings.keepArmed,
          onValueChange: (v) => {
            settings.updateSettings({ keepArmed: v });
            notifyButton();
          }
        })
      ),
      h(RN.Text, { style: { color: palette().sub, fontSize: 13, paddingHorizontal: 4 } }, "Build " + BUILD)
    )
  );
}
const step = (name, fn) => {
  try {
    fn();
  } catch (e) {
    console.error(`[QuickTranslate] ${name} failed:`, e);
  }
};
function onChannelSelect(e) {
  const id = e && e.channelId != null ? String(e.channelId) : null;
  if (id === lastChannelId) return;
  lastChannelId = id;
  if (armed) {
    armed = null;
    notifyButton();
  }
}
var stdin_default = {
  name: "QuickTranslate",
  description: "Translate messages and your own text with Google Translate. Chat bar button, translate on send, quick languages.",
  id: "quicktranslate",
  version: "1.3.0",
  start() {
    renderErrors = 0;
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
      } catch (_) {
      }
    }
    if (renderUnpatch) {
      try {
        renderUnpatch();
      } catch (_) {
      }
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
  settings: Settings
};
