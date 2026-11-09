import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("original UI has the same settings sections and composer controls in the shipped plugin", () => {
  const source = readFileSync(
    new URL("fixtures/original-rain.js.txt", import.meta.url),
    "utf8",
  );
  const bundle = readFileSync(
    new URL("../build/js/index.js", import.meta.url),
    "utf8",
  );
  for (const label of [
    "Translation service",
    "Translation rules",
    "Quick languages",
    "Immersive auto-translate",
    "Highlight Translate Draft button",
    "Keep translate active",
    "Button position",
    "Hide Gift button",
    "Translate once",
    "Permanent language",
    "Try ",
    "Jump to message",
    "Scroll down to load 25 older messages",
  ]) {
    assert.ok(source.includes(label), "Baseline contains " + label);
    assert.ok(
      bundle.includes(label.replace("25 older", "30 older")),
      "Missing original control: " + label,
    );
  }
});

import { environment } from "./support/harness.ts";
import { createHash } from "node:crypto";
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
const digest = (value: any) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

// These are the explicitly requested beta5/beta6 changes; all other layout/style
// properties are still compared with the unmodified uploaded reference.
function approvedBaseline(value: any): any {
  if (Array.isArray(value))
    return value
      .filter(
        (node) =>
          !(
            node?.type === "Text" &&
            typeof node.props?.children === "string" &&
            node.props.children.startsWith("Current color: ")
          ),
      )
      .map(approvedBaseline);
  if (!value || typeof value !== "object")
    return value === "Translate messages to"
      ? "Quick translate messages to"
      : value === "Scroll down to load 25 older messages"
        ? "Scroll down to load 30 older messages"
        : value === "Loading 25 older messages…"
          ? "Loading 30 messages…"
          : value;
  if (
    value.type === "Text" &&
    typeof value.props?.children === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.props.children)
  )
    return null;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, approvedBaseline(item)]),
  );
  if (
    result.type === "Pressable" &&
    result.props?.children?.type === "Animated.View" &&
    result.props.children.props?.style?.opacity !== undefined
  ) {
    const disabled = !!result.props.disabled;
    result.props = {
      ...result.props,
      disabled,
      accessibilityState: { disabled },
      style: { opacity: disabled ? 0.45 : 1 },
    };
    delete result.props.children.props.style.opacity;
  }
  if (
    result.props?.accessibilityLabel === "Drag down to close translate menu"
  ) {
    for (const key of [
      "onStartShouldSetResponder",
      "onMoveShouldSetResponder",
      "onMoveShouldSetResponderCapture",
      "onResponderMove",
      "onResponderRelease",
      "onResponderTerminate",
      "onResponderTerminationRequest",
    ])
      result.props[key] = "[callback]";
  }
  if (result.props?.accessibilityLabel === "Close translate menu") {
    result.props.style.top = 3;
    const old = result.props.children;
    result.props.children = ["45deg", "-45deg"].map((rotate) => ({
      $$typeof: old.$$typeof,
      type: "View",
      props: {
        pointerEvents: "none",
        style: {
          position: "absolute",
          left: 12,
          top: 18,
          width: 14,
          height: 2,
          borderRadius: 1,
          backgroundColor: old.props.style.color,
          transform: [{ rotate }],
        },
      },
    }));
  }
  return result;
}
function approvedCurrent(value: any): any {
  if (Array.isArray(value))
    return value
      .filter(
        (node) =>
          !(
            node?.type === "View" &&
            node.props?.style?.marginBottom === 24 &&
            JSON.stringify(node.props.children?.[0]).includes(
              "Auto-detect overrides",
            )
          ),
      )
      .map(approvedCurrent);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, approvedCurrent(item)]),
  );
}
function difference(a: any, b: any, path = "root"): string {
  if (Object.is(a, b)) return "";
  if (!a || !b || typeof a !== typeof b || typeof a !== "object")
    return path + ": " + JSON.stringify(a) + " != " + JSON.stringify(b);
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const diff = difference(a[key], b[key], path + "." + key);
    if (diff) return diff;
  }
  return "";
}
for (const theme of ["dark", "light"]) {
  test(`settings and every original subpage retain their rendered layout (${theme})`, async () => {
    const current = environment(),
      baselineEnv = environment();
    try {
      const port = await current.port();
      port.implementation.installTextBridge();
      const baseline = baselineEnv.baseline(port.integration.createPluginStore);
      current.stores.ThemeStore.theme = theme;
      baselineEnv.stores.ThemeStore.theme = theme;
      const data = {
        provider: "deepl",
        deeplApiKey: "test-key",
        historyEntries: [
          {
            id: "entry",
            original: "hello",
            translated: "salut",
            source: "en",
            target: "ro",
            provider: "google",
            at: 1700000000000,
            channelId: "c",
            messageId: "m",
          },
        ],
      };
      port.implementation.useQuickTranslate.attach(
        data,
        current.storage,
        () => {},
      );
      baseline.useQuickTranslate.attach(data, baselineEnv.storage, () => {});
      for (const [name, props] of [
        ["Settings", {}],
        ["LangPicker", { field: "targetOut" }],
        ["LangPicker", { field: "sourceOut" }],
        ["FavPicker", {}],
        ["ColorPicker", {}],
        ["HistoryPage", {}],
        ["AutoChannelsPage", {}],
        [
          "BulkMessageSelector",
          {
            request: {
              channelId: "c",
              nonce: 1,
              seedMessage: {
                id: "m",
                channel_id: "c",
                content: "Hello",
                author: { username: "Friend" },
              },
            },
            onClose: () => {},
            onTranslate: () => {},
          },
        ],
      ] as [string, any][]) {
        if (name === "BulkMessageSelector" && props.request.seedMessage?.id)
          baselineEnv.overrides.BulkMessageSelector = {
            0: [String(props.request.seedMessage.id)],
          };
        const actual = current.normalize(
          current.render(port.implementation[name], props),
        );
        const expected = baselineEnv.normalize(
          baselineEnv.render(baseline[name], props),
        );
        assert.equal(
          digest(approvedCurrent(actual)),
          digest(approvedBaseline(expected)),
          `Original layout changed: ${name}: ${difference(actual, approvedBaseline(expected))}`,
        );
      }
    } finally {
      current.dispose();
      baselineEnv.dispose();
    }
  });
  for (const page of ["main", "source", "target"])
    test(`original composer modal retains ${page} page (${theme})`, async () => {
      const current = environment(),
        baselineEnv = environment();
      try {
        const port = await current.port(),
          baseline = baselineEnv.baseline(port.integration.createPluginStore);
        port.implementation.installTextBridge();
        current.stores.ThemeStore.theme = theme;
        baselineEnv.stores.ThemeStore.theme = theme;
        port.implementation.useQuickTranslate.attach(
          {},
          current.storage,
          () => {},
        );
        baseline.useQuickTranslate.attach({}, baselineEnv.storage, () => {});
        current.overrides.TranslateButton = { 1: true, 2: page };
        baselineEnv.overrides.TranslateButton = { 1: true, 2: page };
        assert.equal(
          digest(
            current.normalize(
              current.render(port.implementation.TranslateButton, {
                position: "actions",
              }),
            ),
          ),
          digest(
            approvedBaseline(
              baselineEnv.normalize(
                baselineEnv.render(baseline.TranslateButton, {
                  position: "actions",
                }),
              ),
            ),
          ),
        );
      } finally {
        current.dispose();
        baselineEnv.dispose();
      }
    });
}
