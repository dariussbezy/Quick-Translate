import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function harness() {
  const cleanup: (() => unknown)[] = [],
    hooks: any[] = [],
    finders: any[] = [],
    events = new Map<string, Function>();
  const dispatcher = { dispatch: () => {}, subscribe: () => {} };
  const selected = { getChannelId: () => "channel" };
  const storage = {
    cache: {} as any,
    get: async () => storage.cache,
    set: async (value: any) => Object.assign(storage.cache, value),
    use: () => storage.cache,
  };
  const patcher = Object.fromEntries(
    ["before", "after", "instead"].map((kind) => [
      kind,
      (target: any, key: string, fn: Function) => {
        const hook = { kind, target, key, fn, active: true };
        hooks.push(hook);
        return () => {
          hook.active = false;
        };
      },
    ]),
  );
  const valenced = {
    react: {
      ReactNative: { StyleSheet: { create: (s: any) => s } },
      ReactJSXRuntime: {},
    },
    modules: {
      finders: {
        filters: {
          createFilterGenerator: () => (name: string) => ({ component: name }),
          withProps: (...props: string[]) => ({ props }),
          withName: (name: string) => ({ name }),
        },
        getModules: (filter: any, fn: Function) => {
          const f = { filter, fn, active: true };
          finders.push(f);
          if (filter.props?.[0] === "dispatch") fn(dispatcher);
          return () => {
            f.active = false;
          };
        },
      },
    },
    patcher,
    discord: {
      flux: {
        Stores: {
          SelectedChannelStore: selected,
          MessageStore: { getMessage: () => undefined },
          UserStore: { getCurrentUser: () => ({ id: "self" }) },
        },
        onFluxEventDispatched: (name: string, fn: Function) => {
          events.set(name, fn);
          return () => events.delete(name);
        },
      },
      actions: {
        ActionSheetActionCreators: {
          openLazy: () => {},
          hideActionSheet: () => {},
        },
      },
    },
  };
  const context = {
    valenced,
    plugin: (options: any) => options,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch,
  };
  const bundle = vm.runInNewContext(
    readFileSync(new URL("../build/js/index.js", import.meta.url), "utf8"),
    context,
  );
  storage.cache = structuredClone(bundle.default.jsonStorage.default);
  return {
    plugin: bundle.default,
    cleanup,
    hooks,
    finders,
    events,
    storage,
    valenced,
  };
}
test("compiled plugin registers and fully removes hooks/listeners on stop", async () => {
  const h = harness(),
    errors: any[] = [];
  await h.plugin.start({
    cleanup: (...fns: Function[]) => h.cleanup.push(...(fns as any)),
    jsonStorage: h.storage,
    logger: { warn: () => {}, error: () => {} },
    plugin: { reportError: (e: any) => errors.push(e) },
  });
  assert.equal(h.events.size, 1);
  assert.ok(h.finders.length >= 6);
  assert.equal(h.hooks.length, 1);
  for (const fn of h.cleanup.reverse()) await fn();
  assert.equal(h.events.size, 0);
  assert.ok(h.hooks.every((h) => !h.active));
  assert.ok(h.finders.every((f) => !f.active));
  assert.deepEqual(errors, []);
});
test("automatic outgoing translation preserves channel/options and does not send after errors", async () => {
  const h = harness();
  await h.plugin.start({
    cleanup: (...f: Function[]) => h.cleanup.push(...(f as any)),
    jsonStorage: h.storage,
    logger: { warn: () => {}, error: () => {} },
    plugin: { reportError: () => {} },
  });
  const sendFinder = h.finders.find((f) =>
    f.filter.props?.includes("sendMessage"),
  );
  sendFinder.fn({ sendMessage: () => {}, receiveMessage: () => {} });
  const hook = h.hooks.find((h) => h.key === "sendMessage");
  let sent = 0;
  const original = (...args: any[]) => {
    sent++;
    return args;
  };
  const args = ["channel", { content: "hello" }, "nonce"];
  const result = hook.fn.call({}, args, original);
  assert.equal(result[2], "nonce");
  assert.equal(sent, 1);
  h.storage.cache.autoOutgoing = true;
  h.storage.cache.provider = "deepl";
  h.storage.cache.deeplApiKey = "";
  await assert.rejects(hook.fn.call({}, args, original), /API key/);
  assert.equal(sent, 1);
  for (const fn of h.cleanup.reverse()) await fn();
});
test("incoming event hook returns original event and ignores unselected conversations", async () => {
  const h = harness();
  await h.plugin.start({
    cleanup: (...f: Function[]) => h.cleanup.push(...(f as any)),
    jsonStorage: h.storage,
    logger: { warn: () => {}, error: () => {} },
    plugin: { reportError: () => {} },
  });
  const event = {
    message: {
      id: "m",
      channel_id: "other",
      content: "hello",
      author: { id: "someone" },
    },
  };
  assert.equal(h.events.get("MESSAGE_CREATE")!(event), event);
  assert.equal(h.storage.cache.history.length, 0);
  for (const fn of h.cleanup.reverse()) await fn();
});
