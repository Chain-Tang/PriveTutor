# HANDOFF — Annotation Tutor Lite

A handoff for the next agent/maintainer taking over this project. Read this before
making changes or cutting a release.

## 1. What this project is

**Annotation Tutor Lite** (`annotation-tutor-lite`) is a standalone, desktop-only
**Obsidian plugin**: you highlight a passage, write what you think it means, and an AI
tutor reviews it, distills durable **memory cells**, auto-groups them into **scenes**,
resurfaces them on a spaced-repetition schedule (SM-2), and weaves them into a readable
**notebook** — plus inline / full-document **translation**. Everything is plain Markdown
in the user's Vault; no server, no database, no API key baked into the code.

- **Repo:** `Chain-Tang/AnnotationTutor`, branch `main` (this repo *is* the plugin — it was a
  monorepo until the standalone restructure; the old full project is only in git history).
- **Current version:** see `manifest.json` (`0.1.5`). Latest GitHub Release: `v0.1.5`.
- **Runtime:** runs inside Obsidian's bundled Electron/Node runtime — **end users do NOT
  install Node.js**. It's desktop-only because it uses Node APIs (spawning a CLI, fs).

## 2. Project composition

```
.                              ← repo root = the plugin
├── manifest.json              # Obsidian plugin manifest (id, version, author, minAppVersion)
├── styles.css                 # all plugin CSS (Obsidian theme tokens)
├── package.json               # scripts + deps (private; not published to npm)
├── pnpm-workspace.yaml        # `packages: []` — keeps this a standalone single package
├── pnpm-lock.yaml             # lockfile (commit it)
├── tsconfig.json              # strict TS (noUncheckedIndexedAccess, noImplicitOverride)
├── vitest.config.ts           # node env, globals, tsconfig path resolution
├── .github/workflows/ci.yml   # CI: pnpm install/typecheck/test/build on Win+macOS+Linux
├── docs/guide.md              # deep learning-model reference (linked from README)
├── PrivTutor Lite MVP Design Spec.md   # original product baseline (historical)
├── README.md                  # English (restyled: header + live badges; no images yet)
├── README.zh-CN.md            # Simplified Chinese (plain; not yet restyled to match)
├── scripts/
│   ├── build.mjs              # esbuild bundle → dist/main.js (`--watch` for dev)
│   ├── package.mjs            # build + stage dist/release/<id>/ + write the release ZIP
│   └── install-dev-plugin.mjs # copy built files into a Vault's plugins folder (--vault)
├── src/
│   ├── (pure, unit-tested — no `obsidian`/`@codemirror/view` runtime import)
│   │   model.ts, ids.ts, anchors.ts, srs.ts, memory-derive.ts, learning.ts,
│   │   index-table.ts, decorations-plan.ts, settings-config.ts, i18n.ts,
│   │   translate.ts, pretranslate.ts, reading-highlight.ts, agent-runner.ts, markdown/*
│   └── (Obsidian/CM6-bound)
│       main.ts (wiring), store.ts (file I/O + self-write guard), watcher.ts,
│       decorations.ts, margin-rail.ts, reading-rail.ts, margin-card.ts, editor.ts,
│       settings.ts, views/*, *-controller.ts, acp-runner.ts/acp-session.ts (OpenCode
│       over ACP), api-runner.ts (Direct API)
└── tests/                     # vitest, colocated by feature (≈272 tests at handoff)
```

**Two engines** (chosen in Settings → engine):
- **Direct API** (default): OpenAI-compatible HTTP, no subprocess. Key stored in the
  Vault's plugin data only.
- **OpenCode**: spawns the user's already-authenticated `opencode` CLI over ACP. No key
  stored. The plugin augments `PATH` so the CLI resolves even when Obsidian is launched
  from the GUI.

**Two distinct "agent" roles** — don't confuse them:
- The **engine** above powers in-plugin reviews/translation/chat (self-contained prompts).
- `Agent Memory/` + `AGENTS.md` are generated *in the user's Vault* so an **external**
  agent (Claude Code/OpenCode/Codex) can read/extend the learning memory. Auto-created on
  first plugin load (`store.ensureScaffold()`); never shipped in the download.

## 3. What goes to GitHub vs what must NOT

**Commit & push (source of truth):**
- Everything under `src/`, `tests/`, `scripts/`, `docs/`
- `manifest.json`, `styles.css`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `tsconfig.json`, `vitest.config.ts`, `.github/`, both READMEs, the design spec, this file.

**Never commit (gitignored — see `.gitignore`):**
- `node_modules/` — dependencies (reinstall with `pnpm install`).
- `dist/` — **build output, including the compiled `main.js` and the release ZIP.** These
  are NOT in the repo; they ship via GitHub Releases only.
- `*.tsbuildinfo`.
- `Tutor/` — a **local dev Vault** (test data + an installed copy of the plugin). It may
  exist on the current machine; it must not enter the repo.

**Never commit, ever (secrets):**
- No provider API keys or credentials belong anywhere in the repo. The user's Direct-API
  key lives only in `<Vault>/.obsidian/plugins/annotation-tutor-lite/data.json` (inside the
  user's Vault, not this repo). OpenCode uses the user's own authenticated CLI.

**Release assets (uploaded to a GitHub Release, NOT committed):**
- `annotation-tutor-lite-<version>.zip` (extracts to a `annotation-tutor-lite/` folder)
- loose `main.js`, `manifest.json`, `styles.css` (what Obsidian/BRAT expect).
- ⚠️ GitHub auto-attaches "Source code (zip/tar.gz)" to every release — those are the dev
  source with **no compiled `main.js`**. Tell users to download the named `…-<version>.zip`
  asset, not the source archives.

## 4. How to accept the work (verify it builds and runs)

Prereqs: **Node.js 22.13+** and **pnpm 10** (only for development — not for end users).

```bash
git clone https://github.com/Chain-Tang/AnnotationTutor.git
cd AnnotationTutor
pnpm install
pnpm typecheck && pnpm test && pnpm build    # the gate — expect ~272 tests green
```

Run it in a real Vault and smoke-test:

```bash
pnpm install:vault -- --vault "/path/to/a/test/Vault"   # build + copy + enable
```

Then in Obsidian (reload with `Ctrl/Cmd+R`):
1. Confirm an `Agent Memory/` folder + `AGENTS.md` were auto-created in the Vault.
2. Settings → pick an engine (Direct API + a key is the zero-dependency path).
3. Select text → `Ctrl/Cmd+Shift+L` → write a note → ask the tutor to review.
4. Check the margin comment card, the highlight-as-toggle, and the connector.
5. `Alt+T` inline translation (works in both editing and Reading view).
6. Build the notebook; review a due cell.

## 5. How to cut a release

```bash
# 1. Bump the version in BOTH manifest.json and package.json (keep them in sync).
# 2. Commit + push the bump.
git commit -am "chore: release vX.Y.Z" && git push origin main
# 3. Build the assets (pure-Node ZIP with forward slashes — works on macOS/Linux).
pnpm package          # → dist/annotation-tutor-lite-X.Y.Z.zip + dist/release/<id>/*
# 4. Publish (gh is NOT on PATH on the current Windows machine — use the full path):
"C:\Program Files\GitHub CLI\gh.exe" release create vX.Y.Z \
  --repo Chain-Tang/AnnotationTutor --target main --title "Annotation Tutor Lite vX.Y.Z" \
  --notes-file <notes.md> \
  dist/annotation-tutor-lite-X.Y.Z.zip \
  dist/release/annotation-tutor-lite/main.js \
  dist/release/annotation-tutor-lite/manifest.json \
  dist/release/annotation-tutor-lite/styles.css
# 5. Verify: gh release view vX.Y.Z --json tagName,assets ; gh release list
```
`gh` is authenticated as `Chain-Tang` (token in the OS keyring; `gh auth login` needs a
real interactive terminal — a non-interactive shell cannot drive the browser flow).

## 6. Conventions & gotchas (don't regress these)

- **Commit identity:** `Chain <chain2423408957@gmail.com>`. **Never** add a Claude
  co-author trailer. Direct commits to `main` (no PR) is the owner's convention.
- **Run pnpm at the repo ROOT** (this used to be a monorepo subdir — it isn't anymore).
- **Tests can't import `obsidian`/`@codemirror/view`.** Keep logic that needs unit tests in
  the pure modules (only `import type` of Obsidian is OK). DOM/CM6 code stays untested.
- **The release ZIP must use forward-slash paths.** `package.mjs` writes the ZIP in pure
  Node for this reason — do NOT switch back to PowerShell `Compress-Archive` (it writes
  backslash entry names that break extraction on macOS/Linux).
- **Engine settings must always render** (engine picker + API key + OpenCode config) — they
  were once hidden behind the off-by-default "Auto-run agent" toggle; don't re-gate them.
- **Cross-platform matters:** several modules special-case Windows (CLI lookup, quoting,
  PATH). CI runs Win/macOS/Linux; keep it green.
- Strict TS; UI strings go through `t()` in `i18n.ts` (en / zh-cn / zh-tw / ja).

## 7. Open items / next steps

- **README images:** the owner will add their own screenshots; the placeholder hero/grid
  and `docs/images/` were removed. Add a clean Screenshots section once images exist.
- **`README.zh-CN.md`** is the plain version — mirror the English README's header/badges if
  bilingual parity is wanted.
- **No `LICENSE` file** yet (default copyright). Add one (e.g. MIT) if open-sourcing.
- **No `CLAUDE.md`** (the monorepo one was removed). Run `/init` to regenerate a
  Lite-focused one if desired.
- **Contributor graph:** git history has a stray `Your Name <you@example.com>` on 2 early
  commits (no Claude anywhere). Cleaning it needs a history rewrite + force-push — only with
  the owner's explicit go-ahead.
