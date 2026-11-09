import { test } from "node:test";
import assert from "node:assert/strict";
import { environment } from "./support/harness.ts";
async function engine(settings: any = {}) {
  const env = environment(),
    port = await env.port();
  port.implementation.useQuickTranslate.attach(settings, env.storage, () => {});
  port.integration.startIntegration((error: any) => env.errors.push(error));
  port.implementation.installTextBridge();
  return {
    env,
    port,
    finish: () => {
      port.integration.stopIntegration();
      env.dispose();
    },
  };
}
const response = (text: string, source = "en") => ({
  ok: true,
  status: 200,
  json: async () => [[[text]], null, source],
  headers: { get: () => null },
});

test("original protected words, code, links and mentions survive outgoing translation", async () => {
  const { env, port, finish } = await engine({ protectedWords: ["Alice"] });
  try {
    const original =
      "Hello Alice malice <@123> <a:wave:456> https://example.com `x = 1`";
    const protectedText = port.implementation.protect(original);
    assert.ok(protectedText.out.includes("malice"));
    assert.ok(!protectedText.out.includes("Alice"));
    assert.equal(
      port.implementation.restore(
        protectedText.out.replace("Hello", "Salut"),
        protectedText.tokens,
        false,
      ),
      original.replace("Hello", "Salut"),
    );
  } finally {
    finish();
  }
});
test("identical simultaneous requests share the provider request and cached result", async () => {
  const { env, port, finish } = await engine();
  try {
    let calls = 0;
    env.transport(async (url: string) => {
      calls++;
      const source = new URL(url).searchParams.get("q")!;
      return response(source.replace("Hello", "Salut"));
    });
    const [a, b] = await Promise.all([
      port.implementation.translate("Hello <@123>", "ro", "auto", false),
      port.implementation.translate("Hello <@123>", "ro", "auto", false),
    ]);
    assert.equal(a.text, "Salut <@123>");
    assert.equal(b.text, a.text);
    assert.equal(calls, 1);
    await port.implementation.translate("Hello <@123>", "ro", "auto", false);
    assert.equal(calls, 1);
  } finally {
    finish();
  }
});
test("DeepL errors retain the original Google fallback behavior", async () => {
  const { env, port, finish } = await engine({
    provider: "deepl",
    deeplApiKey: "key:fx",
  });
  try {
    const requests: string[] = [];
    env.transport(async (url: string) => {
      requests.push(url);
      if (url.includes("deepl.com"))
        return {
          ok: false,
          status: 503,
          json: async () => ({ message: "Unavailable" }),
          headers: { get: () => null },
        };
      return response("Salut");
    });
    const translated = await port.implementation.translate(
      "Hello",
      "ro",
      "en",
      false,
    );
    assert.equal(translated.provider, "google");
    assert.equal(translated.text, "Salut");
    assert.ok(requests[0].startsWith("https://api-free.deepl.com"));
    assert.ok(requests[1].startsWith("https://translate.googleapis.com"));
  } finally {
    finish();
  }
});
test("HTTP 429 does not trigger fallback or repeated provider requests", async () => {
  const { env, port, finish } = await engine({
    provider: "deepl",
    deeplApiKey: "key:fx",
  });
  try {
    let calls = 0;
    env.transport(async () => {
      calls++;
      return {
        ok: false,
        status: 429,
        json: async () => ({ message: "Rate limited" }),
        headers: { get: () => "60" },
      };
    });
    await assert.rejects(
      port.implementation.translate("First", "ro", "en", false),
      /429/,
    );
    await assert.rejects(
      port.implementation.translate("Second", "ro", "en", false),
      /paused/,
    );
    assert.equal(calls, 1);
  } finally {
    finish();
  }
});
test("stopping cancels active and queued translation without a late provider call", async () => {
  const { env, port, finish } = await engine();
  try {
    let calls = 0;
    env.transport((_url: string, options: any) => {
      calls++;
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        ),
      );
    });
    const first = port.implementation.translate("First", "ro", "en", false),
      second = port.implementation.translate("Second", "ro", "en", false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    port.integration.stopIntegration();
    await Promise.all([assert.rejects(first), assert.rejects(second)]);
    assert.equal(calls, 1);
  } finally {
    finish();
  }
});
test("language defaults can be saved per chat without changing global preferences", async () => {
  const { env, port, finish } = await engine();
  try {
    port.implementation.saveChatLanguages("c", {
      targetOut: "ro",
      sourceOut: "en",
    });
    assert.equal(port.implementation.getChatLanguages("c").targetOut, "ro");
    assert.equal(port.implementation.getChatLanguages("dm").targetOut, "en");
    await port.implementation.useQuickTranslate.flush();
    assert.equal(env.storage.cache.chatLanguages.c.targetOut, "ro");
  } finally {
    finish();
  }
});
test("previous Valenced beta preferences and history migrate into the original schema", async () => {
  const env = environment();
  try {
    const port = await env.port();
    const data = {
      provider: "deepl",
      targetOut: "ro",
      showButton: false,
      history: [
        {
          original: "Hello",
          text: "Salut",
          source: "en",
          target: "ro",
          channelId: "c",
          messageId: "m",
          time: 1700000000000,
        },
      ],
      saved: [
        {
          original: "Hello",
          text: "Salut",
          source: "en",
          target: "ro",
          channelId: "c",
          messageId: "m",
          time: 1700000000000,
        },
      ],
    };
    port.implementation.useQuickTranslate.attach(data, env.storage, () => {});
    const state = port.implementation.useQuickTranslate.getState();
    assert.equal(state.provider, "deepl");
    assert.equal(state.targetOut, "ro");
    assert.equal(state.showButton, false);
    assert.equal(state.historyEntries[0].translated, "Salut");
    assert.equal(state.messageTranslations[0].messageId, "m");
    assert.equal(state.draftBeforeSend, true);
    assert.equal(state.anchor, "actions");
    state.updateSettings({ translationColor: "#ABCDEF" });
    await port.implementation.useQuickTranslate.flush();
    assert.equal(env.storage.cache.translationColor, "#ABCDEF");
    assert.equal(env.storage.cache.history, undefined);
  } finally {
    env.dispose();
  }
});
test("Auto-detect rules translate a word with its chosen source without forcing the whole sentence", async () => {
  const { env, port, finish } = await engine({
    wordLanguageRules: [{ word: "Salut", language: "ro" }],
  });
  try {
    const calls: any[] = [];
    env.transport(async (url: string) => {
      const u = new URL(url);
      calls.push([u.searchParams.get("q"), u.searchParams.get("sl")]);
      return response(
        calls.length === 1 ? "Hello" : u.searchParams.get("q")!,
        "en",
      );
    });
    const result = await port.implementation.translate(
      "Salut, my friend!",
      "en",
      "auto",
      false,
    );
    assert.equal(result.text, "Hello, my friend!");
    assert.equal(result.same, false);
    assert.deepEqual(calls[0], ["Salut", "ro"]);
    assert.equal(calls[1][1], "auto");
  } finally {
    finish();
  }
});
test("explicit source languages bypass word rules", async () => {
  const { env, port, finish } = await engine({
    wordLanguageRules: [{ word: "Salut", language: "ro" }],
  });
  try {
    const calls: any[] = [];
    env.transport(async (url: string) => {
      const u = new URL(url);
      calls.push(u.searchParams.get("sl"));
      return response("Health", "ca");
    });
    const result = await port.implementation.translate(
      "Salut",
      "en",
      "ca",
      false,
    );
    assert.equal(result.text, "Health");
    assert.deepEqual(calls, ["ca"]);
  } finally {
    finish();
  }
});
test("a provider cannot silently drop a forced word from the translated sentence", async () => {
  const { env, port, finish } = await engine({
    wordLanguageRules: [{ word: "Salut", language: "ro" }],
  });
  try {
    let requests = 0;
    env.transport(async () =>
      response(++requests === 1 ? "Hello" : "The word marker was lost", "en"),
    );
    await assert.rejects(
      port.implementation.translate("Salut, friend", "en", "auto", false),
      /word-rule marker/,
    );
  } finally {
    finish();
  }
});
