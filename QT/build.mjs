import { build } from "esbuild";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
process.chdir(fileURLToPath(new URL(".", import.meta.url)));
await mkdir("build", { recursive: true });
for (const name of ["build", "generate-index"]) {
  await build({
    entryPoints: [`tooling/official-cli/${name}.ts`],
    outfile: `build/official-${name}.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
  });
}
const { run } = await import("./build/official-build.mjs");
await run([basename(process.cwd()), "--plugins-dir", ".."]);
if (process.exitCode) throw new Error("Official Valenced compiler failed");
const script = await readFile("build/js/index.js", "utf8");
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const archiveName = `Quick-Translate-Valenced-${manifest.version}.zip`;
const archive = zipSync({
  "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
  "index.js": strToU8(script),
});
await writeFile("build/quick-translate.zip", archive);
await writeFile("index.js", script);
await writeFile(archiveName, archive);
const base =
  "https://raw.githubusercontent.com/dariussbezy/Quick-Translate/refs/heads/codex/quick-translate-valenced-beta/QT";
const { generateIndex } = await import("./build/official-generate-index.mjs");
const config = JSON.parse(await readFile("repo.config.json", "utf8"));
const archives = (await readdir("."))
  .filter((name) => /^Quick-Translate-Valenced-.*\.zip$/.test(name))
  .sort();
const index = generateIndex(
  archives.map((file) => ({ file, url: `${base}/${file}` })),
  {
    ...config,
    channels: {
      ...config.channels,
      [manifest.id]: {
        ...config.channels?.[manifest.id],
        latest: manifest.version,
      },
    },
  },
);
await writeFile("index.json", JSON.stringify(index, null, 2) + "\n");
console.log(
  `Packaged ${manifest.id}@${manifest.version}: ${Buffer.byteLength(script)} JS bytes`,
);
console.log(
  `Generated repository index for ${archives.length} published artifact(s)`,
);
