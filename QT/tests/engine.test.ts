import { test } from "node:test";
import assert from "node:assert/strict";
import { protect, restore, Engine } from "../src/engine.ts";

test("Discord syntax, URLs, code and protected whole words survive translation", () => {
  const original =
    "Hello <@123> <a:wave:123> https://example.com `x=1` Alice malice";
  const p = protect(original, ["Alice"]);
  assert.equal(
    restore(p.text.replace("Hello", "Salut"), p.tokens),
    original.replace("Hello", "Salut"),
  );
  assert.ok(p.text.includes("malice"));
  assert.ok(!p.text.includes("Alice"));
});
test("refuses a translation that loses protected content", () => {
  const p = protect("Hello <@123>", []);
  assert.throws(() => restore("Salut", p.tokens), /protected/i);
});
test("deduplicates simultaneous requests and bounds cache", async () => {
  let calls = 0;
  const engine = new Engine(
    async (text) => {
      calls++;
      return { text: text + "!", source: "en" };
    },
    { gap: 0, cacheLimit: 2 },
  );
  const opts = {
    provider: "google" as const,
    target: "ro",
    source: "auto",
    key: "",
    words: [],
  };
  await Promise.all([
    engine.translate("one", opts),
    engine.translate("one", opts),
  ]);
  assert.equal(calls, 1);
  await engine.translate("one", opts);
  assert.equal(calls, 1);
  await engine.translate("two", opts);
  await engine.translate("three", opts);
  assert.equal(engine.cacheSize, 2);
  engine.dispose();
});
test("stopping aborts active work and prevents queued requests", async () => {
  let calls = 0;
  const engine = new Engine(
    (_, __, signal) => {
      calls++;
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    },
    { gap: 0 },
  );
  const opts = {
    provider: "google" as const,
    target: "ro",
    source: "auto",
    key: "",
    words: [],
  };
  const first = engine.translate("one", opts);
  const second = engine.translate("two", opts);
  await new Promise((r) => setTimeout(r, 10));
  engine.dispose();
  await Promise.all([assert.rejects(first), assert.rejects(second)]);
  assert.equal(calls, 1);
});
test("HTTP 429 pauses the queue without making more provider calls", async () => {
  let calls = 0;
  const engine = new Engine(
    async () => {
      calls++;
      throw Object.assign(new Error("rate"), { retryAfter: 60000 });
    },
    { gap: 0 },
  );
  const opts = {
    provider: "google" as const,
    target: "ro",
    source: "auto",
    key: "",
    words: [],
  };
  await assert.rejects(engine.translate("one", opts));
  await assert.rejects(engine.translate("two", opts), /paused/i);
  assert.equal(calls, 1);
  engine.dispose();
});
test("clearing data cancels in-flight results so they cannot refill cache", async () => {
  let finish!: (value: { text: string; source: string }) => void;
  const engine = new Engine(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    { gap: 0 },
  );
  const request = engine.translate("hello", {
    provider: "google",
    target: "ro",
    source: "auto",
    key: "",
    words: [],
  });
  await new Promise((r) => setTimeout(r, 0));
  engine.clear();
  finish({ text: "salut", source: "en" });
  await assert.rejects(request, /cancelled/i);
  assert.equal(engine.cacheSize, 0);
  engine.dispose();
});
