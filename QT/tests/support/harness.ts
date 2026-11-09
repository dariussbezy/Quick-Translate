import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
let compiled: string;
function testBundle() {
  return (compiled ??= buildSync({
    stdin: {
      contents: `import * as implementation from './src/original.js'; import * as integration from './src/valenced'; import plugin from './src/index'; export {implementation,integration,plugin};`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
    jsx: "automatic",
  }).outputFiles[0].text);
}
export function environment() {
  let activeName = "",
    slot = 0;
  const overrides: Record<string, Record<number, any>> = {};
  const stateChanges: any[] = [];
  const h = (type: any, props: any, ...children: any[]) => ({
    $$typeof: Symbol.for("react.transitional.element"),
    type,
    key: props?.key ?? null,
    props: {
      ...props,
      ...(children.length
        ? { children: children.length === 1 ? children[0] : children }
        : {}),
    },
  });
  const clone = (element: any, props: any, ...children: any[]) =>
    h(
      element.type,
      { ...element.props, ...props, key: props?.key ?? element.key },
      ...(children.length ? children : [element.props.children]),
    );
  const React: any = {
    createElement: h,
    cloneElement: clone,
    isValidElement: (e: any) =>
      !!e && typeof e === "object" && !!e.props && e.type != null,
    Fragment: "Fragment",
    Children: {
      toArray: (c: any) =>
        [c].flat(Infinity).filter((x) => x != null && x !== false),
    },
    useState: (initial: any) => {
      const index = slot++;
      const value =
        overrides[activeName]?.[index] ??
        (typeof initial === "function" ? initial() : initial);
      return [
        value,
        (next: any) => {
          stateChanges.push({ name: activeName, index, next });
        },
      ];
    },
    useRef: (initial: any) => ({ current: initial }),
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
    useSyncExternalStore: (_: any, get: any) => get(),
  };
  class Value {
    value: number;
    constructor(v: number) {
      this.value = v;
    }
    setValue(v: number) {
      this.value = v;
    }
    interpolate(config: any) {
      return { animated: this.value, ...config };
    }
  }
  const animation = {
    start: (fn?: any) => fn?.({ finished: true }),
    stop: () => {},
  };
  const RN: any = new Proxy(
    {
      View: "View",
      Text: "Text",
      Image: "Image",
      ScrollView: "ScrollView",
      Pressable: "Pressable",
      TextInput: "TextInput",
      Modal: "Modal",
      ActivityIndicator: "ActivityIndicator",
      TouchableOpacity: "TouchableOpacity",
      Animated: {
        Value,
        View: "Animated.View",
        Text: "Animated.Text",
        timing: () => animation,
        spring: () => animation,
        parallel: () => animation,
      },
      StyleSheet: {
        create: (x: any) => x,
        flatten: (s: any) => (Array.isArray(s) ? Object.assign({}, ...s) : s),
      },
      Dimensions: { get: () => ({ height: 800, width: 400 }) },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      Easing: { out: () => {}, in: () => {}, cubic: () => {} },
      processColor: (c: string) => c,
    },
    { get: (t: any, k: any) => (k in t ? t[k] : String(k)) },
  );
  const messages = new Map<string, any>();
  const channels: any = {
    c: { id: "c", name: "general", guild_id: "guild", type: 0 },
    dm: { id: "dm", type: 1, recipients: ["friend"] },
  };
  let channelId = "c";
  const stores: any = {
    SelectedChannelStore: { getChannelId: () => channelId },
    MessageStore: {
      getMessage: (c: string, id: string) => messages.get(`${c}:${id}`),
      getMessages: (c: string) => ({
        toArray: () => [...messages.values()].filter((m) => m.channel_id === c),
      }),
    },
    ChannelStore: {
      getChannel: (id: string) => channels[id],
      getMutableGuildChannelsForGuild: () => ({ c: channels.c }),
    },
    PrivateChannelSortStore: { getPrivateChannelIds: () => ["dm"] },
    UserStore: {
      getCurrentUser: () => ({ id: "me" }),
      getUser: (id: string) => ({
        id,
        username: id === "friend" ? "Friend" : id,
      }),
    },
    ThemeStore: { theme: "dark" },
    GuildStore: {
      getGuilds: () => ({ guild: { id: "guild", name: "Server" } }),
    },
  };
  const events = new Map<string, Set<Function>>(),
    patches: any[] = [],
    observations: any[] = [],
    toasts: string[] = [],
    opened: any[] = [],
    routes = new Map();
  const dispatches: any[] = [];
  const dispatcher = {
    dispatch: (event: any) => {
      dispatches.push(event);
      return event;
    },
    subscribe: () => {},
    unsubscribe: () => {},
  };
  const modules: any[] = [dispatcher];
  const filters = {
    withProps: (...props: string[]) => ({ props }),
    withName: (name: string) => ({ name }),
    createFilterGenerator:
      (predicate: any, key: any) =>
      (...args: any[]) => ({
        predicate: (value: any) => predicate(args, 0, value),
        key: key(args),
      }),
  };
  const matches = (filter: any, value: any) =>
    filter.props
      ? filter.props.every((p: string) => value?.[p] !== undefined)
      : filter.name
        ? value?.name === filter.name
        : filter.predicate(value);
  const find = (filter: any) => modules.find((value) => matches(filter, value));
  const finders = {
    lookupModule: (filter: any) => {
      const value = find(filter);
      return value ? [value, modules.indexOf(value)] : [];
    },
    getModules: (filter: any, fn: any) => {
      const obs = { filter, fn, active: true };
      observations.push(obs);
      const value = find(filter);
      if (value) {
        fn(value);
        obs.active = false;
      }
      return () => {
        obs.active = false;
      };
    },
  };
  const addModule = (value: any) => {
    modules.push(value);
    for (const obs of observations)
      if (obs.active && matches(obs.filter, value)) {
        obs.active = false;
        obs.fn(value);
      }
  };
  const patch =
    (kind: string) => (target: any, key: string, hook: Function) => {
      const orig = target[key];
      if (typeof orig !== "function") throw new Error(`Missing method ${key}`);
      const info = { kind, key, active: true };
      patches.push(info);
      function wrapped(this: any, ...args: any[]) {
        if (!info.active) return orig.apply(this, args);
        return kind === "before"
          ? orig.apply(this, hook.call(this, args) ?? args)
          : hook.call(this, args, orig);
      }
      target[key] = wrapped;
      return () => {
        info.active = false;
        if (target[key] === wrapped) target[key] = orig;
      };
    };
  const sheets = {
    openLazy: (promise: any, key: string, props: any) => {
      opened.push({ promise, key, props });
    },
    hideActionSheet: () => {},
  };
  const exportsMap: any = {
    react: React,
    "react/jsx-runtime": {
      jsx: (type: any, props: any, key: any) => h(type, { ...props, key }),
      jsxs: (type: any, props: any, key: any) => h(type, { ...props, key }),
    },
    "react-native": RN,
    "@valenced/modules/finders": finders,
    "@valenced/modules/finders/filters": filters,
    "@valenced/patcher": { before: patch("before"), instead: patch("instead") },
    "@valenced/discord/flux": {
      Stores: stores,
      onFluxEventDispatched: (type: string, fn: any) => {
        const group = events.get(type) ?? new Set();
        events.set(type, group);
        group.add(fn);
        return () => {
          group.delete(fn);
          if (!group.size) events.delete(type);
        };
      },
    },
    "@valenced/discord/actions": {
      ActionSheetActionCreators: sheets,
      ToastActionCreators: {
        open: (_: string, data: any) => toasts.push(data.text),
      },
    },
    "@valenced/discord/design": {
      Design: new Proxy({}, { get: (_, key) => String(key) }),
    },
    "@valenced/assets": { getAssetIdByName: () => 42 },
    "@valenced/externals/react-native-clipboard": {
      Clipboard: { setString: () => {} },
    },
    "@valenced/externals/react-navigation": {
      ReactNavigationNative: { useNavigation: () => navigation },
    },
    "@valenced/discord/modules/settings": {
      onSettingsModulesLoaded: (fn: any) => {
        fn();
        return () => {};
      },
      registerSettingsItem: (key: string, config: any) => {
        routes.set(key, config);
        return () => routes.delete(key);
      },
      refreshSettings: () => {},
    },
  };
  const navigation = {
    push: () => {},
    goBack: () => {},
    canGoBack: () => true,
    popToTop: () => {},
    getParent: () => undefined,
    setOptions: () => {},
  };
  const errors: any[] = [];
  const cleanup: Function[] = [];
  let transport: any = async () => {
    throw new Error("Unexpected network request in test");
  };
  const trackedTimers = new Set<any>();
  const timed = (fn: any, ms: number) => {
    const id = setTimeout(() => {
      trackedTimers.delete(id);
      fn();
    }, ms);
    trackedTimers.add(id);
    return id;
  };
  const untimed = (id: any) => {
    trackedTimers.delete(id);
    clearTimeout(id);
  };
  const context: any = {
    console: {
      ...console,
      error: (...e: any[]) => errors.push(e),
      warn: (...e: any[]) => errors.push(e),
    },
    setTimeout: timed,
    clearTimeout: untimed,
    AbortController,
    fetch: (...args: any[]) => transport(...args),
    plugin: (options: any) => options,
    exports: {},
    require: (id: string) => {
      if (!(id in exportsMap)) throw new Error("Missing test module: " + id);
      return exportsMap[id];
    },
  };
  context.module = { exports: context.exports };
  const storage: any = {
    cache: {},
    writes: [],
    get: async () => storage.cache,
    set: async (value: any, replace = false) => {
      storage.cache = replace ? value : { ...storage.cache, ...value };
      storage.writes.push(value);
    },
  };
  const expand = (node: any): any => {
    if (node == null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(expand);
    if (node.type && node.props) {
      if (typeof node.type === "function") {
        const previous = activeName,
          previousSlot = slot;
        activeName = node.type.name;
        slot = 0;
        try {
          return expand(node.type(node.props));
        } finally {
          activeName = previous;
          slot = previousSlot;
        }
      }
      const props = { ...node.props };
      if (typeof props.style === "function")
        props.style = props.style({ pressed: false });
      props.children = expand(props.children);
      return { ...node, props };
    }
    return node;
  };
  const normalize = (value: any, key?: string): any => {
    if (typeof value === "function") return "[callback]";
    if (typeof value === "symbol") return String(value);
    if (typeof value === "string")
      return value.replace(
        /Quick Translate v(?:1\.0\.8|2\.0\.0-beta\d+)/g,
        "Quick Translate <version>",
      );
    if (Array.isArray(value)) return Array.from(value, (x) => normalize(x));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => k !== "key")
          .map(([k, v]) => [k, normalize(v, k)]),
      );
    return value;
  };
  const render = (Component: any, props: any = {}) => {
    activeName = Component.name;
    slot = 0;
    return expand(h(Component, props));
  };
  return {
    React,
    RN,
    stores,
    messages,
    modules,
    events,
    patches,
    observations,
    toasts,
    opened,
    routes,
    dispatches,
    addModule,
    errors,
    cleanup,
    storage,
    context,
    exportsMap,
    overrides,
    stateChanges,
    render,
    normalize,
    transport: (fn: any) => {
      transport = fn;
    },
    setChannel: (id: string) => {
      channelId = id;
    },
    dispose: () => {
      for (const id of trackedTimers) clearTimeout(id);
      trackedTimers.clear();
    },
    shipped() {
      const map = JSON.parse(
        readFileSync(
          root + "node_modules/@valenced/types/modules.importmap.json",
          "utf8",
        ),
      );
      const aliases: any = {
        react: "valenced.react.React",
        "react-native": "valenced.react.ReactNative",
        "react/jsx-runtime": "valenced.react.ReactJSXRuntime",
      };
      const runtime: any = {};
      for (const [name, value] of Object.entries(exportsMap)) {
        const target =
          aliases[name] ??
          (typeof map[name] === "string" ? map[name] : map[name]?.global);
        if (!target) continue;
        const parts = target.split(".").slice(1);
        let parent = runtime;
        for (const key of parts.slice(0, -1)) parent = parent[key] ??= {};
        parent[parts.at(-1)!] = value;
      }
      context.valenced = runtime;
      const options = vm.runInNewContext(
        readFileSync(root + "build/js/index.js", "utf8"),
        context,
      ).default;
      storage.cache = structuredClone(options.jsonStorage.default);
      return options;
    },
    async port() {
      vm.runInNewContext(testBundle(), context);
      const result = context.module.exports;
      const rawDefaults = result.implementation.useQuickTranslate.defaults;
      storage.cache = structuredClone(rawDefaults);
      return result;
    },
    baseline(storeFactory: any) {
      const rain = {
        api: {
          assets: { findAssetId: () => 42 },
          patcher: {
            before: () => () => {},
            after: () => () => {},
            instead: () => () => {},
          },
          storage: { createPluginStore: storeFactory },
          ui: { toasts: { showToast: () => {} } },
        },
        utils: { findInReactTree: () => undefined },
        metro: {
          findByName: () => undefined,
          findByProps: () => undefined,
          findByStoreName: (name: string) => stores[name],
          findByTypeDisplayName: () => undefined,
          common: {
            clipboard: { setString: () => {} },
            FluxDispatcher: dispatcher,
            NavigationNative: { useNavigation: () => navigation },
            React,
            ReactNative: RN,
            stores,
          },
        },
      };
      const source = readFileSync(
        new URL("../fixtures/original-rain.js.txt", import.meta.url),
        "utf8",
      );
      context.rain = rain;
      const names =
        "Settings,LangPicker,FavPicker,ColorPicker,HistoryPage,AutoChannelsPage,TranslateButton,ComposerSendSlot,BulkMessageSelector,CustomSection,CustomRow,CustomSwitch,CustomAction,CustomInput,KitHero,KitTile,KitGuide,KitChevron,palette,useQuickTranslate";
      vm.runInNewContext(
        source + `\n;pluginStarted=true;globalThis.baseline={${names}};`,
        context,
      );
      return context.baseline;
    },
  };
}
