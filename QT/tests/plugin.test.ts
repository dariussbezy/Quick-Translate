import { test } from "node:test";
import assert from "node:assert/strict";
import { environment } from "./support/harness.ts";
const reply = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => [[[text]], null, "en"],
  headers: { get: () => null },
});
async function started(settings: any = {}) {
  const env = environment(),
    port = await env.port();
  Object.assign(env.storage.cache, settings);
  await port.plugin.start({
    jsonStorage: env.storage,
    cleanup: (...functions: Function[]) => env.cleanup.push(...functions),
    plugin: {
      startedLate: false,
      requireReload: () => {},
      reportError: (error: any) => env.errors.push(error),
    },
  });
  return {
    env,
    port,
    async stop() {
      for (const fn of env.cleanup.splice(0).reverse()) await fn();
      env.dispose();
    },
  };
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (!node) return;
  if (predicate(node)) return node;
  for (const child of [node?.props?.children].flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
test("start registers native settings routes, event observers and hooks; stop removes everything", async () => {
  const { env, stop } = await started();
  assert.ok(env.routes.has("DariussQuickTranslatePage"));
  assert.ok(env.events.has("MESSAGE_CREATE"));
  assert.ok(env.events.has("CHANNEL_SELECT"));
  assert.ok(env.observations.some((x) => x.filter.name === "RowManager"));
  await stop();
  assert.equal(env.events.size, 0);
  assert.equal(env.routes.size, 0);
  assert.ok(env.patches.every((p) => !p.active));
  assert.ok(env.observations.every((p) => !p.active));
  assert.deepEqual(env.errors, []);
});
test("Valenced Flux interceptor forwards incoming events unchanged after observing them", async () => {
  const { env, stop } = await started();
  try {
    const event = {
      message: {
        id: "m",
        channel_id: "c",
        content: "hello",
        author: { id: "other" },
      },
    };
    for (const observer of env.events.get("MESSAGE_CREATE")!)
      assert.equal(observer(event), event);
  } finally {
    await stop();
  }
});
test("modern memoized composer is patched and its original render signature is preserved", async () => {
  const { env, stop } = await started();
  try {
    const type = Object.assign(
      (props: any) => env.React.createElement("OriginalActions", props),
      { displayName: "ChatInputActions" },
    );
    const component = { type };
    env.addModule(component);
    const result = component.type({ shouldShowGiftButton: true });
    assert.equal(result.type, "View");
    assert.equal(result.props.children[0].type, "OriginalActions");
    assert.equal(result.props.children[0].props.shouldShowGiftButton, false);
    assert.equal(result.props.children[1].type.name, "TranslateButton");
  } finally {
    await stop();
  }
});
test("original translate-to and bulk actions appear without mutating Discord menu elements", async () => {
  const { env, port, stop } = await started();
  try {
    const message = { id: "m", channel_id: "c", content: "Hello" };
    const root = env.React.createElement(
      "Group",
      {},
      env.React.createElement("Row", { label: "Copy", onPress: () => {} }),
    );
    const sheet =
      env.exportsMap["@valenced/discord/actions"].ActionSheetActionCreators;
    sheet.openLazy(
      Promise.resolve({ default: () => root }),
      "MessageLongPressActionSheet",
      { message },
    );
    const wrapped = await env.opened[0].promise;
    const output = wrapped.default({});
    const rows = output.props.children;
    assert.deepEqual(
      Array.from(rows, (row: any) => row.props.label),
      ["Translate to English", "Bulk translate…", "Translate to...", "Copy"],
    );
    assert.equal(root.props.children.props.label, "Copy");
    const plan = port.implementation.messagePlan(message);
    assert.equal(plan.length, 3);
  } finally {
    await stop();
  }
});
test("armed outgoing translation preserves attachments, nonce, channel and method receiver", async () => {
  const { env, port, stop } = await started({
    draftBeforeSend: false,
    targetOut: "ro",
  });
  try {
    env.transport(async () => reply("Salut"));
    const calls: any[] = [];
    const module = {
      receiveMessage() {},
      sendMessage(...args: any[]) {
        calls.push({ receiver: this, args });
        return args;
      },
    };
    env.addModule(module);
    const button = env.render(port.implementation.TranslateButton, {
      position: "actions",
    });
    find(
      button,
      (node: any) => node.props?.accessibilityLabel === "Translate message",
    ).props.onAccessibilityTap();
    const payload = {
      content: "Hello",
      validNonShortcutEmojis: [],
      attachments: [{ id: "a" }],
    };
    const result = await module.sendMessage("c", payload, "nonce", {
      reply: "message",
    });
    assert.equal(calls[0].receiver, module);
    assert.equal(result[0], "c");
    assert.equal(result[1].content, "Salut");
    assert.equal(result[1].attachments, payload.attachments);
    assert.equal(result[2], "nonce");
    assert.equal(result[3].reply, "message");
    assert.equal(payload.content, "Hello");
  } finally {
    await stop();
  }
});
test("two-step draft mode translates the composer first and keeps the send action separate", async () => {
  const { env, port, stop } = await started();
  try {
    let draft = "Hello";
    const input = {
      setNativeProps: ({ text }: any) => {
        draft = text;
      },
    };
    env.RN.TextInput = {
      render: (props: any, ref: any) => {
        ref(input);
        return props;
      },
    };
    port.implementation.installInputCapture();
    env.RN.TextInput.render(
      {
        multiline: true,
        returnKeyType: "send",
        value: draft,
        onChangeText: (text: string) => {
          draft = text;
        },
      },
      () => {},
    );
    let network = 0;
    env.transport(async () => {
      network++;
      return reply("Salut");
    });
    const actions = env.render(port.implementation.TranslateButton, {
      position: "actions",
    });
    find(
      actions,
      (node: any) => node.props?.accessibilityLabel === "Translate message",
    ).props.onAccessibilityTap();
    const sendSlot = env.render(port.implementation.ComposerSendSlot, {
      button: "TRANSLATE",
      children: "SEND",
    });
    assert.ok(JSON.stringify(sendSlot).includes("TRANSLATE"));
    const ok = await port.implementation.translateCurrentText("ro", "en");
    assert.equal(ok, true);
    assert.equal(draft, "Salut");
    assert.equal(network, 1);
    port.implementation.restoreOriginal();
    assert.equal(draft, "Hello");
  } finally {
    await stop();
  }
});
test("a translated draft is not applied after the user changes conversation", async () => {
  const { env, port, stop } = await started();
  try {
    let draft = "Hello",
      finish: any;
    env.RN.TextInput = {
      render: (props: any, ref: any) => {
        ref({ setNativeProps: () => {} });
        return props;
      },
    };
    port.implementation.installInputCapture();
    env.RN.TextInput.render(
      {
        multiline: true,
        returnKeyType: "send",
        value: draft,
        onChangeText: (text: string) => {
          draft = text;
        },
      },
      () => {},
    );
    env.transport(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = port.implementation.translateCurrentText("ro", "en");
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.setChannel("dm");
    finish(reply("Salut"));
    assert.equal(await pending, false);
    assert.equal(draft, "Hello");
  } finally {
    await stop();
  }
});
test("translated message rows retain original typography and do not mutate cached messages", async () => {
  const { env, port, stop } = await started({ targetIn: "ro" });
  try {
    const message = {
      id: "m",
      channel_id: "c",
      content: "Hello",
      author: { id: "friend" },
    };
    env.messages.set("c:m", message);
    const row = {
      type: 1,
      changeType: 0,
      message: {
        id: "m",
        channelId: "c",
        content: [{ type: "text", content: "Hello" }],
      },
    };
    class RowManager {
      generate(_input: any) {
        return row;
      }
    }
    env.addModule(RowManager);
    env.transport(async () => reply("Salut"));
    const plan = port.implementation.messagePlan(message);
    plan[0].press();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const manager = new RowManager();
    const rendered = manager.generate({ message });
    assert.equal(message.content, "Hello");
    assert.deepEqual(row.message.content, [{ type: "text", content: "Hello" }]);
    assert.ok(JSON.stringify(rendered).includes("Salut"));
    assert.equal(
      rendered.changeType,
      2,
      "Native rows must be marked changed to bind the translation",
    );
    assert.ok(JSON.stringify(rendered).includes("Hello"));
    const colored = findAst(rendered, (node: any) => node.type === "link");
    assert.equal(colored.context.username, 1);
    assert.equal(colored.context.medium, true);
    assert.equal(
      colored.context.usernameOnClick.linkColor,
      env.RN.processColor("#8EA1FF"),
    );
    assert.ok(!env.dispatches.some((e) => e.message?.flags !== undefined));
    port.implementation.showOriginal(message);
    const restored = manager.generate({ message });
    assert.equal(
      restored.changeType,
      2,
      "Removing the translation must also redraw native text",
    );
    assert.ok(!JSON.stringify(restored).includes("Salut"));
    assert.equal(
      manager.generate({ message }).changeType,
      0,
      "Unchanged originals should not be forced to rebind",
    );
  } finally {
    await stop();
  }
});
test("message menu keeps original action ordering before Copy", async () => {
  const { env, stop } = await started();
  try {
    const root = env.React.createElement("Group", {}, [
      env.React.createElement("Row", { label: "Reply", onPress: () => {} }),
      env.React.createElement("Row", { label: "Copy", onPress: () => {} }),
    ]);
    const sheet =
      env.exportsMap["@valenced/discord/actions"].ActionSheetActionCreators;
    sheet.openLazy(
      Promise.resolve({ default: () => root }),
      "MessageLongPressActionSheet",
      { message: { id: "m", channel_id: "c", content: "Hello" } },
    );
    const wrapped = await env.opened[0].promise,
      output = wrapped.default({});
    assert.deepEqual(
      Array.from(output.props.children, (row: any) => row.props.label),
      [
        "Reply",
        "Translate to English",
        "Bulk translate…",
        "Translate to...",
        "Copy",
      ],
    );
  } finally {
    await stop();
  }
});
test("bulk selector fetches the next 30 messages using the original history cursor", async () => {
  const { env, port, stop } = await started();
  try {
    const base = 1000000000000000000n;
    for (let i = 0; i < 30; i++) {
      const id = String(base + BigInt(i));
      env.messages.set("c:" + id, {
        id,
        channel_id: "c",
        content: "Message " + i,
        author: { username: "Friend" },
      });
    }
    const calls: any[] = [];
    env.addModule({
      fetchMessages: async (options: any) => {
        calls.push(options);
        return {};
      },
    });
    const seed = env.messages.get("c:" + String(base + 29n));
    const screen = env.render(port.implementation.BulkMessageSelector, {
      request: { channelId: "c", nonce: 1, seedMessage: seed },
      onClose: () => {},
      onTranslate: () => {},
    });
    const list = find(
      screen,
      (node: any) => typeof node.props?.onScroll === "function",
    );
    list.props.onScroll({
      nativeEvent: {
        contentOffset: { y: 1000 },
        layoutMeasurement: { height: 800 },
        contentSize: { height: 1200 },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].channelId, "c");
    assert.equal(calls[0].limit, 30);
    assert.ok(BigInt(calls[0].before) < BigInt(seed.id));
  } finally {
    await stop();
  }
});
test("history can still jump to its original message and compare another provider", async () => {
  const entry = {
    id: "entry",
    original: "Hello",
    translated: "Salut",
    source: "en",
    target: "ro",
    provider: "google",
    at: 1700000000000,
    channelId: "c",
    messageId: "m",
  };
  const { env, port, stop } = await started({
    historyEntries: [entry],
    deeplApiKey: "key:fx",
  });
  try {
    const calls: any[] = [];
    env.addModule({
      transitionToChannel: (...args: any[]) => calls.push(["channel", ...args]),
    });
    env.addModule({
      jumpToMessage: (...args: any[]) => calls.push(["message", ...args]),
    });
    const timed = env.context.setTimeout;
    env.context.setTimeout = (fn: any, ms: number) =>
      ms === 650 ? timed(fn, 0) : timed(fn, ms);
    const screen = env.render(port.implementation.HistoryPage);
    const contains = (node: any, text: string): boolean =>
      JSON.stringify(node?.props?.children).includes(text);
    const jump = find(
      screen,
      (node: any) =>
        typeof node.props?.onPress === "function" &&
        contains(node, "Jump to message"),
    );
    jump.props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls[0][0], "channel");
    assert.equal(calls[0][1], "c");
    assert.equal(calls[1][0], "message");
    assert.equal(calls[1][1].messageId, "m");
    env.transport(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        translations: [{ text: "Bună", detected_source_language: "EN" }],
      }),
      headers: { get: () => null },
    }));
    const compare = find(
      screen,
      (node: any) =>
        typeof node.props?.onPress === "function" &&
        contains(node, "Try DeepL"),
    );
    await compare.props.onPress();
    await port.implementation.useQuickTranslate.flush();
    const saved =
      port.implementation.useQuickTranslate.getState().historyEntries[0];
    assert.equal(saved.alternativeTranslated, "Bună");
    assert.equal(saved.provider, "google");
  } finally {
    await stop();
  }
});
test("incoming auto-translation still works in selected background channels and DMs", async () => {
  const { env, port, stop } = await started({
    autoChannelIds: ["dm"],
    targetIn: "ro",
  });
  try {
    env.transport(async () => reply("Salut"));
    const event = {
      message: {
        id: "m",
        channel_id: "dm",
        content: "Hello",
        author: { id: "friend" },
      },
    };
    for (const listener of env.events.get("MESSAGE_CREATE")!)
      assert.equal(listener(event), event);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const saved =
      port.implementation.useQuickTranslate.getState().messageTranslations;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].channelId, "dm");
    assert.equal(saved[0].translated, "Salut");
  } finally {
    await stop();
  }
});
test("official compiled bundle loads without Rain and starts/stops using real Valenced API paths", async () => {
  const env = environment();
  try {
    const shipped = env.shipped();
    assert.equal(env.context.rain, undefined);
    await shipped.start({
      jsonStorage: env.storage,
      cleanup: (...f: Function[]) => env.cleanup.push(...f),
      plugin: {
        startedLate: false,
        reportError: (e: any) => env.errors.push(e),
        requireReload: () => {},
      },
    });
    const screen = env.render(shipped.SettingsComponent);
    const rendered = JSON.stringify(env.normalize(screen));
    for (const label of [
      "Translation rules",
      "Keep translate active",
      "Translation history",
      "Button position",
    ])
      assert.ok(rendered.includes(label));
    for (const cleanup of env.cleanup.splice(0).reverse()) await cleanup();
    assert.deepEqual(env.errors, []);
    assert.equal(env.events.size, 0);
    assert.ok(env.patches.every((p) => !p.active));
  } finally {
    env.dispose();
  }
});

test("bulk continue button starts enabled for the seed message and keeps dimming off its animated view", async () => {
  const { env, port, stop } = await started();
  try {
    const props = {
      request: {
        channelId: "c",
        nonce: 1,
        seedMessage: { id: "m", channel_id: "c", content: "Hello" },
      },
      onClose: () => {},
      onTranslate: () => {},
    };
    const screen = env.render(port.implementation.BulkMessageSelector, props);
    const button = find(
      screen,
      (node: any) =>
        typeof node.props?.onPress === "function" &&
        JSON.stringify(node.props.children).includes("Continue to translation"),
    );
    assert.equal(button.props.disabled, false);
    assert.equal(button.props.accessibilityState.disabled, false);
    assert.equal(button.props.style.opacity, 1);
    assert.equal(
      button.props.children.props.style.opacity,
      undefined,
      "Animated transforms must not retain an old disabled opacity",
    );
    assert.ok(JSON.stringify(button).includes("Continue to translation · 1"));
    env.overrides.BulkMessageSelector = { 0: [] };
    const empty = env.render(port.implementation.BulkMessageSelector, props);
    const disabled = find(
      empty,
      (node: any) =>
        typeof node.props?.onPress === "function" &&
        JSON.stringify(node.props.children).includes("Continue to translation"),
    );
    assert.equal(disabled.props.disabled, true);
    assert.equal(disabled.props.style.opacity, 0.45);
  } finally {
    await stop();
  }
});

function findAst(value: any, predicate: (value: any) => boolean): any {
  if (!value || typeof value !== "object") return;
  if (predicate(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findAst(child, predicate);
    if (found) return found;
  }
}
test("translation color is sent as the selected native ARGB value and changes after selecting a preset", async () => {
  const { env, port, stop } = await started({ targetIn: "ro" });
  try {
    const message = { id: "m", channel_id: "c", content: "Hello" };
    env.messages.set("c:m", message);
    class RowManager {
      generate(_args: any) {
        return {
          type: 1,
          changeType: 0,
          message: { id: "m", content: [{ type: "text", content: "Hello" }] },
        };
      }
    }
    env.addModule(RowManager);
    env.transport(async () => reply("Salut"));
    port.implementation.messagePlan(message)[0].press();
    await new Promise((r) => setTimeout(r, 10));
    const manager = new RowManager();
    let row = manager.generate({ message });
    const screen = env.render(port.implementation.ColorPicker);
    const red = find(
      screen,
      (n: any) =>
        typeof n.props?.onPress === "function" &&
        JSON.stringify(n.props.children).includes("Red"),
    );
    red.props.onPress();
    row = manager.generate({ message });
    const link = findAst(row, (n: any) => n.type === "link");
    assert.equal(link.context.username, 1);
    assert.equal(link.context.medium, true);
    assert.equal(
      link.context.usernameOnClick.linkColor,
      env.RN.processColor("#ED4245"),
    );
    assert.equal(row.changeType, 2);
    const nodes = row.message.content;
    assert.equal(
      nodes.filter((n: any) => n.type === "text" && n.content === "\n").length,
      1,
      "Keep a single line break between original and translation",
    );
    assert.equal(message.content, "Hello");
  } finally {
    await stop();
  }
});
test("drag handle receives working responder events and close icon uses centered shapes", async () => {
  const { env, port, stop } = await started();
  try {
    env.overrides.TranslateButton = { 1: true };
    const screen = env.render(port.implementation.TranslateButton, {
      position: "actions",
    });
    const handle = find(
      screen,
      (n: any) =>
        n.props?.accessibilityLabel === "Drag down to close translate menu",
    );
    assert.equal(typeof handle.props.onResponderMove, "function");
    assert.equal(
      handle.props.onMoveShouldSetResponder({}, { dy: 30, dx: 1 }),
      true,
    );
    handle.props.onResponderMove({}, { dy: 120, dx: 0 });
    handle.props.onResponderRelease({}, { dy: 120, vy: 0.8 });
    assert.ok(
      env.stateChanges.some(
        (change) => change.index === 1 && change.next === false,
      ),
    );
    const close = find(
      screen,
      (n: any) => n.props?.accessibilityLabel === "Close translate menu",
    );
    assert.ok(Array.isArray(close.props.children));
    for (const stroke of close.props.children) {
      assert.equal(stroke.type, "View");
      const s = stroke.props.style;
      assert.equal(s.left + s.width / 2, close.props.style.width / 2);
      assert.equal(s.top + s.height / 2, close.props.style.height / 2);
    }
  } finally {
    await stop();
  }
});
test("bulk page reads thirty API results directly even when the Discord cache has only ten", async () => {
  const { env, port, stop } = await started();
  try {
    const body = Array.from({ length: 30 }, (_, i) => ({
      id: String(1000000000000000000n + BigInt(100 - i)),
      channel_id: "c",
      content: "Text " + i,
    }));
    body.slice(0, 10).forEach((m) => env.messages.set("c:" + m.id, m));
    const calls: any[] = [];
    env.addModule({
      HTTP: {
        get: async (options: any) => {
          calls.push(options);
          return { body };
        },
      },
    });
    const page = await port.integration.readHistoryPage("c", null, 30);
    assert.equal(page.messages.length, 30);
    assert.equal(page.hasMore, true);
    assert.equal(calls[0].query.limit, 30);
    await port.integration.readHistoryPage("c", page.before, 30);
    assert.equal(calls[1].query.before, body[29].id);
  } finally {
    await stop();
  }
});
test("bulk selector fills the first thirty from the response and appends thirty per scroll", async () => {
  const { env, port, stop } = await started();
  try {
    const all = Array.from({ length: 100 }, (_, i) => ({
      id: String(1000000000000000000n + BigInt(200 - i)),
      channel_id: "c",
      content: "Text " + i,
    }));
    all.slice(0, 10).forEach((m) => env.messages.set("c:" + m.id, m));
    const calls: any[] = [];
    env.addModule({
      HTTP: {
        get: async (options: any) => {
          calls.push(options);
          const start = options.query.before
            ? all.findIndex((m) => m.id === options.query.before) + 1
            : 0;
          return { body: all.slice(start, start + options.query.limit) };
        },
      },
    });
    const screen = env.render(port.implementation.BulkMessageSelector, {
      request: { channelId: "c", nonce: 1, seedMessage: all[0] },
      onClose: () => {},
      onTranslate: () => {},
    });
    env.runEffects("BulkMessageSelector");
    await new Promise((r) => setTimeout(r, 0));
    let rows = env.stateChanges
      .filter((c) => c.index === 3 && Array.isArray(c.next))
      .at(-1)!.next;
    assert.equal(rows.length, 30);
    assert.equal(calls[0].query.limit, 30);
    const scroll = find(
      screen,
      (n: any) => typeof n.props?.onScroll === "function",
    );
    for (const expected of [60, 90]) {
      const count = env.stateChanges.length;
      scroll.props.onScroll({
        nativeEvent: {
          contentOffset: { y: 1000 },
          layoutMeasurement: { height: 800 },
          contentSize: { height: 1200 },
        },
      });
      await new Promise((r) => setTimeout(r, 0));
      const update = env.stateChanges
        .slice(count)
        .find((c) => c.index === 3 && typeof c.next === "function");
      assert.ok(update);
      rows = update!.next(rows);
      assert.equal(rows.length, expected);
      assert.equal(new Set(rows.map((m: any) => m.id)).size, expected);
    }
    assert.equal(calls.length, 3);
    assert.equal(calls[1].query.before, all[29].id);
    assert.equal(calls[2].query.before, all[59].id);
  } finally {
    await stop();
  }
});
test("provider completion appears after Translating only when a DeepL key is configured", async () => {
  for (const key of ["", "key:fx"]) {
    const { env, port, stop } = await started({
      targetIn: "ro",
      provider: "deepl",
      deeplApiKey: key,
    });
    try {
      env.transport(async (url: string) =>
        url.includes("deepl.com")
          ? {
              ok: false,
              status: 503,
              json: async () => ({ message: "Unavailable" }),
              headers: { get: () => null },
            }
          : reply("Salut"),
      );
      port.implementation
        .messagePlan({ id: "m", channel_id: "c", content: "Hello" })[0]
        .press();
      for (
        let i = 0;
        i < 180 &&
        !env.toasts.some(
          (t) => t === "Translated" || t.startsWith("Translated with"),
        );
        i++
      )
        await new Promise((r) => setTimeout(r, 10));
      assert.equal(env.toasts[0], "Translating...");
      if (key)
        assert.ok(
          env.toasts.includes(
            "Translated with Google Translate (DeepL fallback)",
          ),
        );
      else {
        assert.ok(env.toasts.includes("Translated"));
        assert.ok(!env.toasts.some((t) => t.startsWith("Translated with")));
      }
    } finally {
      await stop();
    }
  }
});
test("word rule editor adds and removes a source rule using the existing settings design", async () => {
  const { env, port, stop } = await started();
  try {
    env.overrides.WordLanguageRulesPage = { 0: "Salut", 1: "ro" };
    let screen = env.render(port.implementation.WordLanguageRulesPage);
    const add = find(
      screen,
      (n: any) =>
        typeof n.props?.onPress === "function" &&
        JSON.stringify(n.props.children).includes("Add rule"),
    );
    add.props.onPress();
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          port.implementation.useQuickTranslate.getState().wordLanguageRules,
        ),
      ),
      [{ word: "Salut", language: "ro" }],
    );
    let selected = "";
    screen = env.render(port.implementation.LangPicker, {
      value: "ro",
      onSelect: (language: string) => {
        selected = language;
      },
    });
    find(
      screen,
      (n: any) =>
        typeof n.props?.onPress === "function" &&
        JSON.stringify(n.props.children).includes("Romanian"),
    ).props.onPress();
    assert.equal(selected, "ro");
    screen = env.render(port.implementation.WordLanguageRulesPage);
    find(
      screen,
      (n: any) =>
        typeof n.props?.onPress === "function" &&
        n.props.children?.type === "Animated.View" &&
        JSON.stringify(n.props.children).includes("Remove"),
    ).props.onPress();
    assert.equal(
      port.implementation.useQuickTranslate.getState().wordLanguageRules.length,
      0,
    );
  } finally {
    await stop();
  }
});
test("successful DeepL rules report DeepL and save only the complete message in history", async () => {
  const { env, port, stop } = await started({
    targetIn: "en",
    provider: "deepl",
    deeplApiKey: "key:fx",
    wordLanguageRules: [{ word: "Salut", language: "ro" }],
  });
  try {
    const requests: any[] = [],
      keys: string[] = [];
    const toast =
      env.exportsMap["@valenced/discord/actions"].ToastActionCreators;
    const open = toast.open;
    toast.open = (key: string, data: any) => {
      keys.push(key);
      open(key, data);
    };
    env.transport(async (_url: string, options: any) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          translations: [
            {
              text: requests.length === 1 ? "Hello" : body.text[0],
              detected_source_language: requests.length === 1 ? "RO" : "EN",
            },
          ],
        }),
        headers: { get: () => null },
      };
    });
    port.implementation
      .messagePlan({
        id: "m",
        channel_id: "c",
        content: "Salut, my friend!",
      })[0]
      .press();
    for (
      let i = 0;
      i < 180 && !env.toasts.includes("Translated with DeepL");
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(env.toasts.includes("Translated with DeepL"));
    assert.equal(requests[0].source_lang, "RO");
    assert.equal(requests[1].source_lang, undefined);
    const history =
      port.implementation.useQuickTranslate.getState().historyEntries;
    assert.equal(history.length, 1);
    assert.equal(history[0].translated, "Hello, my friend!");
    assert.equal(history[0].original, "Salut, my friend!");
    assert.equal(
      new Set(keys).size,
      keys.length,
      "Completion must not reuse the Translating notification key",
    );
  } finally {
    await stop();
  }
});
