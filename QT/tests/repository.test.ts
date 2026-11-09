import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

test("repository index serves the current version and authenticates every ZIP", () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", root), "utf8"),
  );
  const index = JSON.parse(readFileSync(new URL("index.json", root), "utf8"));
  assert.equal(index.format, 1);
  const plugin = index.plugins[manifest.id];
  assert.equal(plugin.channels.latest, manifest.version);
  for (const [version, artifact] of Object.entries(plugin.versions) as [
    string,
    any,
  ][]) {
    const url = new URL(artifact.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "raw.githubusercontent.com");
    const bytes = readFileSync(new URL(url.pathname.split("/").at(-1)!, root));
    assert.equal(bytes.length, artifact.size);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      artifact.sha256,
    );
    const contents = unzipSync(bytes);
    assert.deepEqual(Object.keys(contents).sort(), [
      "index.js",
      "manifest.json",
    ]);
    const packed = JSON.parse(
      new TextDecoder().decode(contents["manifest.json"]),
    );
    assert.equal(packed.version, version);
    assert.equal(packed.id, manifest.id);
    assert.deepEqual(packed.dependencies, artifact.dependencies);
  }
});
