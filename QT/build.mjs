import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
process.chdir(fileURLToPath(new URL(".", import.meta.url)));
await mkdir("build", { recursive: true });
await build({
  entryPoints: ["tooling/official-cli/build.ts"],
  outfile: "build/official-cli.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const { run } = await import("./build/official-cli.mjs");
await run([basename(process.cwd()), "--plugins-dir", ".."]);
if (process.exitCode) throw new Error("Official Valenced compiler failed");
const script = await readFile("build/js/index.js", "utf8");
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
await writeFile(
  "build/quick-translate.zip",
  zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "index.js": strToU8(script),
  }),
);
await writeFile("index.js", script);
await writeFile("Quick-Translate-Valenced-2.0.0-beta1.zip", await readFile("build/quick-translate.zip"));
console.log(
  `Packaged ${manifest.id}@${manifest.version}: ${Buffer.byteLength(script)} JS bytes`,
);
