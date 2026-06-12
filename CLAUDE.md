# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Annotation Tutor turns Obsidian learning annotations into local, agent-readable learning memory. A learner highlights text in a Markdown note, writes an explanation, and an already-authenticated **OpenCode** or **Codex** CLI reviews that explanation through a local MCP server. Desktop-only MVP; no cloud, no model API keys, no vector DB.

The root workspace is the full service-backed MVP. `TutorLite/` is a separate
Markdown-only sibling project with its own commands and is not a pnpm workspace
member. Root Vitest discovery currently includes `TutorLite/tests`, but root
type checking and builds do not validate TutorLite; run its commands explicitly
when changing it.

The current implementation and release gaps are summarized in
`docs/project-status.md`. `Tutor/Annotation Tutor Design Spec.md` is the original
broad product baseline and includes deferred goals that are not current scope.

## Commands

Requires Node.js 22.13+ (uses the built-in `node:sqlite` `DatabaseSync`) and pnpm 10.

- `pnpm check` — the full gate (`typecheck` + `test` + `build`); this is exactly what CI runs.
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm test` / `pnpm test:watch` — vitest (run / watch).
- Run one test file: `pnpm vitest run packages/core/src/core.test.ts`. By name: `pnpm vitest run -t "resolves a block-id anchor"`.
- `pnpm build` — esbuild bundles the two app entry points only. `pnpm build:plugin` / `pnpm dev:plugin` (watch) build just the Obsidian plugin.
- `pnpm install:dev-plugin` — copies the built plugin into `Tutor/.obsidian/plugins/annotation-tutor` so the `Tutor` folder works as a dev Vault.

There is **no per-package build step**. Packages export `./src/index.ts` directly and resolve through tsconfig `paths`; only `apps/cli` and `apps/obsidian-plugin` are bundled by `scripts/build.ts`. ESM throughout (`"type": "module"`, `NodeNext`), so relative imports inside packages use `.js` extensions even though the source is `.ts`.

## Architecture

A pnpm workspace (`apps/*`, `packages/*`) layered by a strict dependency direction. Everything funnels through one orchestrator class.

```text
domain -> core -> service -> apps/{obsidian-plugin, cli}
                |       \-> mcp
                +-> agent-bridges

ui (React) ----------------> apps/obsidian-plugin
```

- **`packages/domain`** — pure Zod schemas + inferred types + `AnnotationTutorError` (carries a `code` and HTTP `status`). The only dependency is `zod`. All payloads crossing a trust boundary are parsed here.
- **`packages/core`** — domain logic and persistence. `AnnotationTutorService` (`service.ts`) is the single application service every interface calls. Other modules: `storage.ts` (file persistence), `indexer.ts` (SQLite/FTS5), `documents.ts` (source-document reading + chunking), `anchors.ts` (re-locating annotations), `permissions.ts`, `host-lease.ts`, `paths.ts`.
- **`packages/service`** — the host. `runtime.ts#startHostedRuntime` wires every dependency together, acquires the write-host lease, mints tokens, starts the Hono server, and registers agent bridges. `app.ts` is the Hono REST API and also mounts the MCP handler at `/mcp`. `client.ts` is the typed client the plugin uses against its own local server. `review-runs.ts` streams agent runs over SSE.
- **`packages/mcp`** — `server.ts` exposes the same service as MCP tools; `http.ts` adapts it to a Web-standard streamable HTTP handler; `setup.ts`/`templates.ts` write provider config (`opencode.json` + `.opencode/skills/...`, or `.codex/config.toml` + `AGENTS.md`) into the Vault.
- **`packages/agent-bridges`** — subprocess bridges to OpenCode and Codex (`review` + `followUp`). The Codex bridge speaks the `codex app-server` JSON-RPC protocol over stdio. `shared.ts` holds the review prompt + the JSON-schema parsing that turns agent output into a validated `AgentReview`. `registry.ts` adds timeout/cancellation handling.
- **`apps/obsidian-plugin`** — the primary write host. Embeds the service in-process and talks to it via `AnnotationTutorApiClient`.
- **`apps/cli`** — alternate write host plus `doctor`/`setup`/`start`/`stop`/`status`/`export`/`rebuild-index`.

### Invariants that constrain almost every change

1. **Authoritative store is files, not SQLite.** Annotations are sidecar JSON (`.obsidian/plugins/annotation-tutor/data/annotations/*.json`); memory cells are Markdown with YAML frontmatter (`Learning Memory/memory-cells/*.md`, frontmatter is the source of truth); learning context is generated Markdown (`Agent Context/recent-learning.md`). `index.sqlite` is a **rebuildable** index — `service.initialize()` / `rebuild-index` regenerate it. All file writes go through the atomic temp-file-then-rename helpers in `storage.ts`.

2. **One write host per Vault.** `HostLease` (`write-host.lock` under `state/`) makes the plugin and CLI mutually exclusive. The plugin can be asked to step aside via `POST /api/host/release` so the CLI can take over; the plugin's polling loop reconnects or re-embeds. New write paths must respect the lease.

3. **REST and MCP are thin shells over `AnnotationTutorService`.** Add behavior to the service, then expose it; don't duplicate logic in `app.ts` or `server.ts`.

4. **Agent access is annotation-ID-first — never an arbitrary Vault path.** Source documents are reachable only via an annotation ID. Path-traversal is guarded in three places (the `vaultRelativePathSchema` refinements in domain, `paths.ts#sourceFile`, and a `realpath` containment check in `documents.ts#load`); keep all three intact.

5. **Two tokens, two roles.** `admin` (plugin/CLI internals) vs `agentReadOnly` (agents + `/mcp`). Tokens live in `state/access-tokens.json` (mode `0600`). The server binds to `127.0.0.1` and rejects any request carrying an `Origin` header (no browsers).

6. **Permission gates** (`permissions.ts`, persisted to `state/permissions.json`): full-document read, persistent review writes, and memory-cell creation are each off by default and enforced in the service — not just the UI. Reviews are normally writable only for a `review_requested` annotation that has none yet, unless `allowPersistentReviewWrites` is set.

7. **No provider credentials in this repo.** Agents must already be authenticated via their own CLIs; the bridges run them in read-only sandboxes pointed at the local MCP URL.

### Cross-cutting behaviors worth knowing before editing

- **Anchor resolution** (`anchors.ts`) is a fallback cascade: block-id → exact text → surrounding-context → fuzzy (Levenshtein, requires user confirmation) → not-found (annotation marked `orphaned`). The plugin generates a `^block-id` on save and removes it on delete only if no sibling annotation still uses it.
- **Document chunking** (`documents.ts`) is heading-aware and token-budgeted (`gpt-tokenizer`); `getProfile` picks a reading strategy (`full` / `ordered-chunks` / `progressive-search`) from the estimated token count, and document sections are mirrored into SQLite FTS5 for `search_document`.
- **Bridges are dependency-injectable for tests.** `CodexBridge`/`OpenCodeBridge` accept a `runtimeFactory`/`appServerCommand`; `bridges.test.ts` drives `fake-codex-app-server.mjs` instead of a real CLI. Follow this pattern rather than shelling out in tests.

## Conventions

- Tests are vitest, colocated as `*.test.ts`, run in the `node` environment with globals enabled and tsconfig path resolution.
- Validate every external input (REST body, MCP arg, file read back from disk) by parsing it through the relevant domain Zod schema. Throw `AnnotationTutorError` with the right `code`/`status` rather than generic errors; `app.ts#onError` maps them to responses.
- Code must pass `tsc` under `strict` plus `noUncheckedIndexedAccess` and `noImplicitOverride` — index access can be `undefined`, and overrides need the keyword.
- CI runs `pnpm check` on Linux, Windows, and macOS. Several modules special-case `win32` (executable lookup, `cmd.exe` invocation, lock-file rename fallbacks); preserve cross-platform behavior.
