# Annotation Tutor TypeScript MVP Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` and test-driven development to implement this plan incrementally.

**Goal:** Build a desktop Obsidian annotation and learning-memory system that can use locally authenticated OpenCode or Codex installations for review, while exposing REST, MCP, and CLI interfaces.

**Architecture:** Use a strict TypeScript monorepo. Sidecar JSON and Markdown are authoritative; SQLite is a rebuildable index. The Obsidian plugin is the default service host and a Node CLI can mutually exclusively take over a Vault.

**Tech Stack:** pnpm, TypeScript, React, Obsidian API, CodeMirror 6, Zod, Hono, MCP TypeScript SDK, `node:sqlite`, Vitest, remark, Commander.

---

## Execution Status - 2026-06-07

**Current state:** The core MVP implementation is substantially complete; final
manual acceptance is still pending. The implementation has moved beyond the
original sequencing: OpenCode and Codex support are both present, along with
SSE review progress, cancellation, a single persisted follow-up, document FTS,
and host takeover.

Milestone status:

1. Repository, workspace, CI, build, tests, and plugin manifest: implemented.
2. Schemas, storage, SQLite, permissions, anchors, and document retrieval:
   implemented and covered by automated tests.
3. Authenticated REST/SSE, MCP, and the write-host lease: implemented and
   covered by automated tests.
4. OpenCode and Codex bridges plus CLI setup, doctor, service, export, and
   rebuild commands: implemented with mocked/fake runtime coverage.
5. Obsidian annotations, dashboard, onboarding, review flow, localization, and
   settings: implemented, but real Obsidian acceptance remains.
6. Installation and all 15 acceptance criteria: partial. The full plugin build
   is installed in `Tutor`, but only `annotation-tutor-lite` is enabled there.

Verification on 2026-06-07:

```text
pnpm check
  19 test files / 95 tests passed
  plugin and CLI builds passed

pnpm --dir TutorLite typecheck
pnpm --dir TutorLite test
  11 test files / 52 tests passed
pnpm --dir TutorLite build
```

Known release blockers:

- No initial Git commit exists; all files are untracked.
- Real OpenCode, real Codex, and end-to-end Obsidian acceptance are not complete.
- Memory-cell management and concept/tag editing do not have complete plugin UI.
- REST has no OpenAPI document.

See [`../../project-status.md`](../../project-status.md) for the authoritative
feature matrix and remaining release gates.

---

## Milestones

1. Establish the repository, workspace, CI, build, test, and plugin manifest.
2. Implement public schemas, atomic storage, SQLite indexing, permissions, anchors, and document retrieval.
3. Implement the authenticated REST/SSE service, MCP tools, and mutual-exclusion host lease.
4. Implement OpenCode and Codex bridges plus CLI setup, doctor, service, export, and rebuild commands.
5. Implement Obsidian editor annotations, dashboard, onboarding, review panel, localization, and settings.
6. Install into the `Tutor` development Vault and verify the 15 MVP acceptance criteria.

## Required Behavior

- Range and block annotations use Obsidian block IDs and sidecar anchor metadata.
- Document APIs accept annotation IDs, never arbitrary paths.
- Documents up to 30k estimated tokens may be read whole; 30k-60k are read as ordered heading-aware chunks; larger documents use outline, search, and bounded neighboring expansion.
- REST requires a bearer token except for a minimal health response and rejects browser-origin requests.
- Agents receive separate read-only credentials and cannot write to the Vault directly.
- `review_requested` permits one review write; persistent review, memory-cell creation, and full-document access have independent settings.
- OpenCode and Codex are explicit choices. Failure never silently changes providers.
- The UI is bilingual, follows Obsidian's locale, and falls back to English.

## Non-goals

No vector database, cross-Vault retrieval, mobile plugin, cloud sync, collaboration, generic chat, automatic grading, Claude Code, or direct model API.
