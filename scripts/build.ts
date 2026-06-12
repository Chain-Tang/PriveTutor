import { build, context, type BuildOptions } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const watch = process.argv.includes("--watch");
const pluginOnly = process.argv.includes("--plugin-only");

const shared: BuildOptions = {
  bundle: true,
  logLevel: "info",
  platform: "node",
  sourcemap: true,
  target: "node22"
};

const builds: BuildOptions[] = [
  {
    ...shared,
    entryPoints: [path.join(root, "apps/obsidian-plugin/src/main.tsx")],
    outfile: path.join(root, "apps/obsidian-plugin/dist/main.js"),
    external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view"],
    format: "cjs",
    jsx: "automatic"
  }
];

if (!pluginOnly) {
  builds.push({
    ...shared,
    entryPoints: [path.join(root, "apps/cli/src/index.ts")],
    outfile: path.join(root, "apps/cli/dist/index.js"),
    banner: { js: "#!/usr/bin/env node" },
    external: ["@opencode-ai/sdk", "yaml"],
    format: "esm"
  });
}

for (const options of builds) {
  const outputDirectory = path.dirname(options.outfile!);
  await mkdir(outputDirectory, { recursive: true });
  if (!watch) {
    await rm(options.outfile!, { force: true });
    await build(options);
    continue;
  }

  const builder = await context(options);
  await builder.watch();
}

if (watch) {
  console.log("Watching Annotation Tutor builds...");
}
