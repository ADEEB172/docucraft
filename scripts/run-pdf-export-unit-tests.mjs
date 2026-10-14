import { readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const root = process.cwd();
const sourcePath = resolve(root, "src/lib/pdfExport.ts");
const instrumentedPath = join(root, "tests", ".pdfExport.instrumented.mjs");
const typescript = require("typescript");
const babel = require("@babel/core");
const istanbulPlugin = require("babel-plugin-istanbul");

const source = await readFile(sourcePath, "utf8");
const instrumented = babel.transformSync(source, {
  filename: sourcePath,
  configFile: false,
  babelrc: false,
  parserOpts: {
    plugins: ["typescript"],
  },
  plugins: [istanbulPlugin],
});

if (!instrumented?.code) {
  throw new Error("Could not instrument pdfExport.ts for unit tests.");
}

const transpiled = typescript.transpileModule(instrumented.code, {
  fileName: sourcePath,
  compilerOptions: {
    module: typescript.ModuleKind.ESNext,
    target: typescript.ScriptTarget.ES2022,
  },
});

await writeFile(instrumentedPath, transpiled.outputText);

try {
  const result = spawnSync(
    process.execPath,
    ["--test", join(root, "tests", "pdfExport.unit.mjs")],
    { stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
} finally {
  await unlink(instrumentedPath).catch((error) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}
