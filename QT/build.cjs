const fs = require("node:fs");
const path = require("node:path");
const dir = __dirname;
const sourcePath = path.join(dir, "index.ts");
const outputPath = path.join(dir, "index.js");
const source = fs.readFileSync(sourcePath, "utf8").replace(/^\/\/ Editable TypeScript mirror of the Rain Quick Translate plugin\.\r?\n\/\/ Rain installs and executes index\.js; run node build\.cjs after edits\.\r?\ndeclare const rain: any;\r?\ndeclare const exports: \{ default: any \};\r?\n/, "");
fs.writeFileSync(outputPath, '"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n' + source);
