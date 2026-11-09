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
    assert.ok(bundle.includes(label), "Missing original control: " + label);
  }
});

import { environment } from "./support/harness.ts";
import { createHash } from "node:crypto";
const digest = (value: any) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
        const actual = current.normalize(
          current.render(port.implementation[name], props),
        );
        const expected = baselineEnv.normalize(
          baselineEnv.render(baseline[name], props),
        );
        assert.equal(
          digest(actual),
          digest(expected),
          `Original layout changed: ${name}`,
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
            baselineEnv.normalize(
              baselineEnv.render(baseline.TranslateButton, {
                position: "actions",
              }),
            ),
          ),
        );
      } finally {
        current.dispose();
        baselineEnv.dispose();
      }
    });
}
