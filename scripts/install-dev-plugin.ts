import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "apps/obsidian-plugin");
const target = path.join(root, "Tutor/.obsidian/plugins/annotation-tutor");

await mkdir(target, { recursive: true });
await cp(path.join(source, "dist/main.js"), path.join(target, "main.js"));
await cp(path.join(source, "manifest.json"), path.join(target, "manifest.json"));
await cp(path.join(source, "styles.css"), path.join(target, "styles.css"));
console.log(`Installed development plugin to ${target}`);

