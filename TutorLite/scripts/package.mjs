// Package the built plugin into release-ready artifacts:
//   dist/release/annotation-tutor-lite/{main.js,manifest.json,styles.css}
//   dist/annotation-tutor-lite-<version>.zip  (the folder, ready to unzip into
//                                              <Vault>/.obsidian/plugins/)
// The loose three files are what Obsidian (and BRAT) expect as release assets;
// the zip is a convenience for manual installers.

import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);
const PLUGIN_ID = "annotation-tutor-lite";
const root = path.resolve(import.meta.dirname, "..");

// 1. Build a fresh dist/main.js (build.mjs runs its one-shot build on import).
await import("./build.mjs");

// 2. Stage the three shippable files into dist/release/<id>/.
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const version = manifest.version ?? "0.0.0";
const releaseDir = path.join(root, "dist", "release");
const pluginDir = path.join(releaseDir, PLUGIN_ID);
await rm(releaseDir, { recursive: true, force: true });
await mkdir(pluginDir, { recursive: true });
for (const [from, to] of [
  ["dist/main.js", "main.js"],
  ["manifest.json", "manifest.json"],
  ["styles.css", "styles.css"]
]) {
  await cp(path.join(root, from), path.join(pluginDir, to));
}
console.log(`Staged ${PLUGIN_ID} v${version} -> ${pluginDir}`);

// 3. Zip the folder so `unzip` drops a ready-to-enable plugin directory.
const zipPath = path.join(root, "dist", `${PLUGIN_ID}-${version}.zip`);
await rm(zipPath, { force: true });
try {
  if (process.platform === "win32") {
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${pluginDir}' -DestinationPath '${zipPath}' -Force`
    ]);
  } else {
    // `zip` keeps the leading folder when run from dist/release/.
    await run("zip", ["-r", zipPath, PLUGIN_ID], { cwd: releaseDir });
  }
  console.log(`Wrote ${zipPath}`);
} catch (error) {
  console.warn(
    `Could not create the zip (${error.message?.split("\n")[0] ?? error}). ` +
      `The loose files in ${pluginDir} are still ready to ship.`
  );
}
