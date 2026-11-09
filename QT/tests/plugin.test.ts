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
      rowType: 1,
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
    const rendered = new RowManager().generate({ rowType: 1 });
    assert.equal(message.content, "Hello");
    assert.deepEqual(row.message.content, [{ type: "text", content: "Hello" }]);
    assert.ok(JSON.stringify(rendered).includes("Salut"));
    assert.ok(JSON.stringify(rendered).includes("Hello"));
    assert.ok(JSON.stringify(rendered).includes("#8EA1FF"));
    assert.ok(!env.dispatches.some((e) => e.message?.flags !== undefined));
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
test("bulk selector fetches the next 25 messages using the original history cursor", async () => {
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
    assert.equal(calls[0].limit, 25);
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
