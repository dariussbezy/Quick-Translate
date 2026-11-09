import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareWordRules } from "../src/word-rules.ts";

test("word rules translate only their whole-word matches and keep the rest for Auto-detect", async () => {
  const calls: any[] = [];
  const result = await prepareWordRules(
    "Salut, my friend! salutari §0§",
    ["`Salut`"],
    [{ word: "Salut", language: "ro" }],
    "en",
    async (text, source) => {
      calls.push([text, source]);
      return "Hello";
    },
  );
  assert.deepEqual(calls, [["Salut", "ro"]]);
  assert.equal(result.out, "§1§, my friend! salutari §0§");
  assert.deepEqual(result.tokens, ["`Salut`", "Hello"]);
  assert.equal(result.applied, true);
});
test("matching ignores case, prefers the longest rule, and protects existing placeholders", async () => {
  const calls: any[] = [];
  const result = await prepareWordRules(
    "SALUT Salut §0§",
    ["https://example.com/Salut"],
    [{ word: "Salut", language: "ro" }],
    "en",
    async (word, language) => {
      calls.push([word, language]);
      return "Hello";
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(result.out, "§1§ §2§ §0§");
  const phrase = await prepareWordRules(
    "good morning",
    [],
    [
      { word: "good", language: "en" },
      { word: "good morning", language: "en" },
    ],
    "ro",
    async () => "bună dimineața",
  );
  assert.equal(phrase.tokens.length, 1);
  assert.equal(phrase.out, "§0§");
});
test("a rule already in the target language protects the word without extra requests", async () => {
  let calls = 0;
  const result = await prepareWordRules(
    "Salut friend",
    [],
    [{ word: "Salut", language: "ro" }],
    "ro",
    async () => {
      calls++;
      return "wrong";
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.out, "§0§ friend");
  assert.equal(result.tokens[0], "Salut");
});
