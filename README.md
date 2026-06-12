# Annotation Tutor

Annotation Tutor turns Obsidian learning annotations into local, agent-readable
learning memory. A learner selects Markdown text, writes an explanation, and can
ask an already authenticated OpenCode or Codex installation to review it.

The repository currently contains two desktop-only implementations:

- The root workspace is the full MVP: sidecar JSON, generated Markdown, a
  rebuildable SQLite/FTS index, REST, MCP, CLI, and an Obsidian plugin.
- [`TutorLite`](TutorLite/README.md) is a separate Markdown-only plugin with no
  server, MCP, or SQLite dependency.

The core MVP implementation is substantially complete at the code and
automated-test level. Real Obsidian and real-provider acceptance testing is
still required before calling it release-ready. See
[`docs/project-status.md`](docs/project-status.md) for the verified feature
matrix and current gaps.

## Requirements

- Node.js 22.13 or newer
- pnpm 10
- Desktop Obsidian
- Optional: an installed and authenticated OpenCode or Codex CLI

## Development

```bash
pnpm install
pnpm check
pnpm install:dev-plugin
```

Open `Tutor` as an Obsidian Vault, enable the **Annotation Tutor** community
plugin, and reload Obsidian after rebuilding the plugin.

Useful commands:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:plugin
pnpm dev:plugin
pnpm install:dev-plugin
```

The standalone CLI is bundled to `apps/cli/dist/index.js`:

```bash
node apps/cli/dist/index.js doctor --vault Tutor
node apps/cli/dist/index.js setup opencode --vault Tutor
node apps/cli/dist/index.js setup codex --vault Tutor
node apps/cli/dist/index.js start --vault Tutor
node apps/cli/dist/index.js status --vault Tutor
node apps/cli/dist/index.js export --vault Tutor
node apps/cli/dist/index.js rebuild-index --vault Tutor
```

`TutorLite` has its own dependencies and commands:

```bash
pnpm --dir TutorLite typecheck
pnpm --dir TutorLite test
pnpm --dir TutorLite build
```

## Architecture

```text
domain -> core -> service -> apps/obsidian-plugin
                |       \-> apps/cli
                +-> mcp
                +-> agent-bridges

ui ---------------------> apps/obsidian-plugin
```

- `packages/domain`: Zod schemas, public types, and domain errors.
- `packages/core`: storage, SQLite/FTS, anchors, permissions, document access,
  write-host leasing, and the shared application service.
- `packages/service`: authenticated REST/MCP host, SSE review runs, runtime
  wiring, and the typed client.
- `packages/mcp`: ten annotation and document tools plus OpenCode/Codex setup.
- `packages/agent-bridges`: read-only OpenCode and Codex review subprocesses.
- `packages/ui`: shared React dashboard, annotation editor, onboarding, and
  localization.

REST and MCP are thin interfaces over the same `AnnotationTutorService`.
Document access always begins with an annotation ID; arbitrary Vault paths are
not accepted.

## Local Data

Authoritative data:

```text
.obsidian/plugins/annotation-tutor/data/annotations/*.json
Learning Memory/memory-cells/*.md
Agent Context/recent-learning.md
```

Derived and rebuildable data:

```text
.obsidian/plugins/annotation-tutor/data/index.sqlite
```

Runtime state, tokens, logs, and the write-host lease stay under:

```text
.obsidian/plugins/annotation-tutor/data/
```

The service binds to `127.0.0.1`, uses separate admin and agent tokens, rejects
browser-origin requests, and never stores model-provider credentials.
