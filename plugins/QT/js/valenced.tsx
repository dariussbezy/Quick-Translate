import { lookupModule, getModules } from "@valenced/modules/finders";
import {
  createFilterGenerator,
  withProps,
  withName,
} from "@valenced/modules/finders/filters";
import { before as vb, instead as vi } from "@valenced/patcher";
import { Stores, onFluxEventDispatched } from "@valenced/discord/flux";
import {
  ActionSheetActionCreators,
  ToastActionCreators,
} from "@valenced/discord/actions";
import { Design } from "@valenced/discord/design";
import { getAssetIdByName } from "@valenced/assets";
import { Clipboard } from "@valenced/externals/react-native-clipboard";
import { ReactNavigationNative } from "@valenced/externals/react-navigation";
import {
  onSettingsModulesLoaded,
  registerSettingsItem,
  refreshSettings,
} from "@valenced/discord/modules/settings";
import * as React from "react";
import * as RN from "react-native";
export { createPluginStore } from "./settings-store";

type AnyModule = Record<string, any>;
type Method = (...args: any[]) => any;
let cleanups: (() => unknown)[] = [];
let running = false;
let epoch = 0;
let report: (error: unknown) => void = () => {};
const controllers = new Set<AbortController>();
const waits = new Set<() => void>();
const subscriptions = new Map<string, Map<Method, () => void>>();
const renderAliases = new WeakMap<object, { target: AnyModule; key: string }>();
const moduleCache = new Map<string, AnyModule>();
const componentFilter = createFilterGenerator<[string]>(
  ([name], _, value) =>
    value?.type?.displayName === name ||
    value?.type?.render?.displayName === name ||
    value?.displayName === name ||
    value?.render?.displayName === name,
  ([name]) => `dariuss.qt.original.component.v1(${name})`,
);
export function startIntegration(onError: (error: unknown) => void) {
  running = true;
  epoch++;
  report = onError;
  moduleCache.clear();
}
export function isRunning() {
  return running;
}
export function stopIntegration() {
  running = false;
  cancelRequests();
  for (const cleanup of cleanups.splice(0).reverse())
    try {
      cleanup();
    } catch (error) {
      report(error);
    }
  subscriptions.clear();
  moduleCache.clear();
}
export function registerCleanup(fn: () => unknown) {
  let active = true;
  const once = () => {
    if (active) {
      active = false;
      return fn();
    }
  };
  cleanups.push(once);
  return once;
}
export const findAssetId = (name: string) => getAssetIdByName(name);
export const clipboard = {
  setString: (value: string) => Clipboard.setString(value),
};
export function findByStoreName(name: string) {
  return (Stores as unknown as AnyModule)[name];
}
export function store(name: string) {
  return new Proxy(
    {},
    {
      get: (_, key) => {
        const source = findByStoreName(name);
        const value = source?.[key];
        return typeof value === "function" ? value.bind(source) : value;
      },
    },
  ) as AnyModule;
}
export function findByName(name: string) {
  const [value] = lookupModule(withName(name));
  return value;
}
export function findByProps(...properties: string[]): AnyModule | undefined {
  if (properties.includes("openLazy") && properties.includes("hideActionSheet"))
    return ActionSheetActionCreators;
  if (properties.includes("showSimpleActionSheet")) {
    const [native] = lookupModule(withProps("showSimpleActionSheet"));
    return (native as AnyModule | undefined) ?? { showSimpleActionSheet };
  }
  const key = properties.join("|");
  if (moduleCache.has(key)) return moduleCache.get(key);
  const [value] = lookupModule(
    withProps(...(properties as [string, ...string[]])),
  );
  if (value) moduleCache.set(key, value as AnyModule);
  return value as AnyModule | undefined;
}
function componentView(value: AnyModule | undefined): AnyModule | undefined {
  if (!value) return;
  const mod = value as AnyModule;
  if (typeof mod.type === "function") {
    const alias = { render: mod.type };
    renderAliases.set(alias, { target: mod, key: "type" });
    return { type: alias };
  }
  if (typeof mod.type?.render === "function") return mod;
  if (typeof mod.render === "function") return { type: mod };
  return undefined;
}
function location(target: AnyModule, key: string) {
  return renderAliases.get(target) ?? { target, key };
}
export function before(
  key: string,
  target: AnyModule,
  hook: (args: any[]) => any,
) {
  const real = location(target, key);
  return registerCleanup(
    vb(
      real.target as Record<string, Method>,
      real.key,
      (args) => hook(args) ?? args,
    ),
  );
}
export function after(
  key: string,
  target: AnyModule,
  hook: (args: any[], result: any) => any,
) {
  const real = location(target, key);
  return registerCleanup(
    vi(
      real.target as Record<string, Method>,
      real.key,
      function (args, original) {
        const result = Reflect.apply(original, this, args);
        const changed = hook(args, result);
        return changed === undefined ? result : changed;
      },
    ),
  );
}
export function instead(
  key: string,
  target: AnyModule,
  hook: (args: any[], original: Method) => any,
) {
  const real = location(target, key);
  return registerCleanup(
    vi(
      real.target as Record<string, Method>,
      real.key,
      function (args, original) {
        return hook(args, (...next) => Reflect.apply(original, this, next));
      },
    ),
  );
}
export function observeName(
  name: string,
  callback: (value: AnyModule) => void,
) {
  return registerCleanup(
    getModules(withName(name), (value) => {
      try {
        callback(value as AnyModule);
      } catch (e) {
        report(e);
      }
    }),
  );
}
export function observeProps(
  props: string[],
  callback: (value: AnyModule) => void,
) {
  return registerCleanup(
    getModules(withProps(...(props as [string, ...string[]])), (value) => {
      try {
        callback(value as AnyModule);
      } catch (e) {
        report(e);
      }
    }),
  );
}
export function observeComponent(
  name: string,
  callback: (component: AnyModule) => void,
) {
  return registerCleanup(
    getModules(componentFilter(name), (value) => {
      const component = componentView(value as AnyModule);
      if (component)
        try {
          callback(component);
        } catch (e) {
          report(e);
        }
    }),
  );
}
export const FluxDispatcher = {
  subscribe(type: string, listener: Method) {
    const group = subscriptions.get(type) ?? new Map();
    subscriptions.set(type, group);
    if (group.has(listener)) return;
    const remove = onFluxEventDispatched(type, (payload) => {
      // This API is an interceptor: observers must always return the event.
      try {
        listener(payload);
      } catch (error) {
        report(error);
      }
      return payload;
    });
    group.set(listener, registerCleanup(remove));
  },
  unsubscribe(type: string, listener: Method) {
    const group = subscriptions.get(type);
    group?.get(listener)?.();
    group?.delete(listener);
  },
  dispatch(payload: AnyModule) {
    const dispatcher = findByProps("dispatch", "subscribe");
    if (!dispatcher) throw new Error("Discord dispatcher unavailable");
    return dispatcher.dispatch(payload);
  },
};
let toastSequence = 0;
export function showToast(text: string) {
  if (!running) return;
  ToastActionCreators.open(`dariuss.quick-translate.${++toastSequence}`, {
    text,
  });
}
export function findInReactTree(
  tree: any,
  predicate: (value: any) => boolean,
  depth = 0,
): any {
  if (depth > 40 || tree == null) return;
  if (predicate(tree)) return tree;
  if (Array.isArray(tree)) {
    for (const node of tree) {
      const found = findInReactTree(node, predicate, depth + 1);
      if (found !== undefined) return found;
    }
  } else if (typeof tree === "object")
    return findInReactTree(tree.props?.children, predicate, depth + 1);
}
export async function fetchWithTimeout(url: string, options: RequestInit = {}) {
  if (!running) throw new Error("Quick Translate is stopped");
  const requestEpoch = epoch,
    controller = new AbortController();
  const upstream = options.signal;
  const abort = () => controller.abort();
  if (upstream?.aborted) throw new Error("Translation cancelled");
  upstream?.addEventListener("abort", abort, { once: true });
  controllers.add(controller);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(url, { ...options, signal: controller.signal }).then((response) => {
        if (!running || epoch !== requestEpoch)
          throw new Error("Translation cancelled");
        return response;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Timed out"));
        }, 12000);
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("Translation cancelled")),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controllers.delete(controller);
    upstream?.removeEventListener("abort", abort);
  }
}
function showSimpleActionSheet(config: {
  key: string;
  header: { title: string };
  options: { label: string; onPress: () => void; isMarked?: boolean }[];
}) {
  const Row = Design.ActionSheetRow as unknown as React.ComponentType<any>;
  const Component = () => (
    <Design.ActionSheet>
      <RN.ScrollView>
        <Design.Text
          variant="heading-lg/bold"
          color="text-default"
          style={{ padding: 16 }}
        >
          {config.header.title}
        </Design.Text>
        {config.options.map((option, index) => (
          <Row key={index} label={option.label} onPress={option.onPress} />
        ))}
      </RN.ScrollView>
    </Design.ActionSheet>
  );
  ActionSheetActionCreators.openLazy(
    Promise.resolve({ default: Component }),
    config.key,
    {},
  );
}
export function installPageRoute() {
  registerCleanup(
    onSettingsModulesLoaded(() => {
      registerCleanup(
        registerSettingsItem("DariussQuickTranslatePage", {
          parent: "dariuss.quick-translate",
          type: "route",
          useTitle: () => "Quick Translate",
          screen: {
            route: "DariussQuickTranslatePage",
            getComponent: () => OriginalSettingsPage,
          },
        }),
      );
      refreshSettings();
    }),
  );
}
function OriginalSettingsPage({ navigation, route }: any) {
  React.useLayoutEffect(() => {
    navigation.setOptions({ title: route.params?.title ?? "Quick Translate" });
  }, [navigation, route.params?.title]);
  const Component = route.params?.render;
  const light = findByStoreName("ThemeStore")?.theme === "light";
  return (
    <RN.View
      style={{ flex: 1, backgroundColor: light ? "#FFFFFF" : "#1E1F22" }}
    >
      {Component ? <Component /> : null}
    </RN.View>
  );
}
export const NavigationNative = {
  useNavigation: () => ReactNavigationNative.useNavigation(),
};

/** Add original message menu actions without mutating Discord's cached React tree. */
export function injectMessageActions(
  tree: any,
  plan: { key: string; label: string; press: () => void }[],
  dismiss: () => void,
): any {
  let inserted = false;
  const visit = (node: any, depth = 0): any => {
    if (depth > 40 || !node) return node;
    if (Array.isArray(node)) {
      const template = node.find(
        (child) =>
          React.isValidElement<AnyModule>(child) &&
          typeof child.props.onPress === "function" &&
          typeof child.props.label === "string",
      );
      if (
        template &&
        !inserted &&
        !node.some((child) => String(child?.key ?? "").startsWith("qt-"))
      ) {
        inserted = true;
        const tint =
          findByStoreName("ThemeStore")?.theme === "light"
            ? "#060607"
            : "#FFFFFF";
        const icon = React.isValidElement<AnyModule>(template.props.icon)
          ? React.cloneElement(template.props.icon, {
              IconComponent: () =>
                React.createElement(RN.Image, {
                  resizeMode: "cover",
                  style: { width: 24, height: 24, tintColor: tint },
                  source: findAssetId("LanguageIcon"),
                }),
            })
          : undefined;
        const rows = plan.map((item) =>
          React.cloneElement(template as React.ReactElement<AnyModule>, {
            key: item.key,
            label: item.label,
            icon,
            onPress: () => {
              dismiss();
              item.press();
            },
          }),
        );
        const copy = node.findIndex((child) =>
          String(child?.props?.label ?? child?.props?.message ?? "")
            .toUpperCase()
            .includes("COPY"),
        );
        const index = copy < 0 ? node.length : copy;
        return [...node.slice(0, index), ...rows, ...node.slice(index)];
      }
      return node.map((child) => visit(child, depth + 1));
    }
    if (React.isValidElement<AnyModule>(node) && node.props.children) {
      const child = node.props.children;
      const singleRow =
        React.isValidElement<AnyModule>(child) &&
        typeof child.props.onPress === "function" &&
        typeof child.props.label === "string";
      return React.cloneElement(
        node,
        {},
        visit(singleRow ? [child] : child, depth + 1),
      );
    }
    return node;
  };
  return visit(tree);
}
export function installMessageMenu(getPlan: (message: AnyModule) => any) {
  registerCleanup(
    vb(ActionSheetActionCreators, "openLazy", (args) => {
      const [promise, key, context] = args as any[];
      if (
        key !== "MessageLongPressActionSheet" ||
        !context?.message ||
        !promise?.then
      )
        return args;
      const plan = getPlan(context.message);
      if (!plan?.length) return args;
      args[0] = promise.then((module: AnyModule) => {
        if (!running || typeof module.default !== "function") return module;
        const Original = module.default;
        return {
          ...module,
          default: function QuickTranslateMessageActions(props: any) {
            return injectMessageActions(Original(props), plan, () =>
              ActionSheetActionCreators.hideActionSheet(key),
            );
          },
        };
      }) as (typeof args)[0];
      return args;
    }),
  );
}
export function cancelRequests() {
  epoch++;
  for (const controller of controllers) controller.abort();
  controllers.clear();
  for (const cancel of waits) cancel();
  waits.clear();
}

export function reportIntegrationError(error: unknown) {
  report(error);
}

export function waitForTurn(ms: number) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      waits.delete(cancel);
      reject(new Error("Translation cancelled"));
    };
    const timer = setTimeout(() => {
      waits.delete(cancel);
      resolve();
    }, ms);
    waits.add(cancel);
  });
}

/** Read the requested page, rather than depending on Discord's small UI cache. */
export async function readHistoryPage(
  channelId: string,
  before: string | null,
  limit = 30,
) {
  if (!running) throw new Error("Quick Translate is stopped");
  const requestEpoch = epoch;
  const client = findByProps("HTTP")?.HTTP;
  let raw: any[];
  if (typeof client?.get === "function") {
    const endpoints = findByProps("Endpoints")?.Endpoints;
    const url =
      typeof endpoints?.MESSAGES === "function"
        ? endpoints.MESSAGES(channelId)
        : `/channels/${encodeURIComponent(channelId)}/messages`;
    const response = await client.get({
      url,
      query: { limit, ...(before ? { before } : {}) },
      oldFormErrors: true,
    });
    if (!Array.isArray(response?.body))
      throw new Error("Discord returned an invalid message page");
    raw = response.body;
  } else {
    const actions = findByProps("fetchMessages");
    if (typeof actions?.fetchMessages !== "function")
      throw new Error("Discord history API is unavailable");
    const result = await actions.fetchMessages({
      channelId,
      limit,
      ...(before ? { before } : {}),
    });
    const collection = findByStoreName("MessageStore")?.getMessages(channelId);
    const body = result?.body ?? result?.messages ?? result;
    raw = Array.isArray(body)
      ? body
      : (collection?.toArray?.() ?? collection?._array ?? []);
    if (before)
      raw = raw.filter(
        (message) => compareSnowflakes(String(message.id), before) < 0,
      );
  }
  if (!running || epoch !== requestEpoch)
    throw new Error("History loading cancelled");
  const records = raw
    .filter((message) => message?.id)
    .map((message) => ({
      ...message,
      channel_id: message.channel_id ?? channelId,
    }))
    .sort((a, b) => compareSnowflakes(String(b.id), String(a.id)))
    .slice(0, limit);
  return {
    messages: records,
    hasMore: raw.length >= limit,
    before: records.at(-1)?.id ? String(records.at(-1).id) : before,
  };
}
function compareSnowflakes(a: string, b: string) {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
