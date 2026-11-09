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
    assert.ok(
      url.pathname.startsWith(
        "/dariussbezy/Quick-Translate/refs/heads/main/QT/",
      ),
      "Published artifacts must come from main",
    );
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

test("current release accepts Plugin API 1.0.0 shipped with Valenced", async () => {
  const { parseVersion, compareVersions } =
    await import("../tooling/official-cli/generate-index.ts");
  const index = JSON.parse(
    readFileSync(new URL("../index.json", import.meta.url), "utf8"),
  );
  const plugin = index.plugins["dariuss.quick-translate"];
  const current = plugin.versions[plugin.channels.latest];
  const hostVersions: Record<string, string> = {
    "valenced.api": "1.0.0",
    discord: "352.6",
  };
  for (const [id, hostVersion] of Object.entries(hostVersions)) {
    const range = current.dependencies[id].version as string;
    const constraints = [...range.matchAll(/(>=|<=|>|<|=)\s*([\d.]+)/g)];
    assert.ok(constraints.length > 0, `Missing version constraints for ${id}`);
    for (const [, operator, version] of constraints) {
      const compared = compareVersions(
        parseVersion(hostVersion),
        parseVersion(version),
      );
      const matches =
        operator === ">="
          ? compared >= 0
          : operator === "<="
            ? compared <= 0
            : operator === ">"
              ? compared > 0
              : operator === "<"
                ? compared < 0
                : compared === 0;
      assert.ok(matches, `${id} ${hostVersion} must satisfy ${range}`);
    }
  }
});
