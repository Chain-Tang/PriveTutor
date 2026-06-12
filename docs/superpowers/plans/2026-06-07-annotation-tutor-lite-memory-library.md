# Annotation Tutor Lite Memory Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement and verify this plan.

**Goal:** Add a Vault-local Annotation → Cell → Scene → Profile memory library
to TutorLite without changing its existing annotation editor experience.

**Architecture:** Markdown and Obsidian Wikilinks are authoritative. A
Zod-validated `index.json` is a rebuildable cache. Agent writes are either
direct or reviewed through Proposal Markdown files.

**Tech Stack:** TypeScript, Obsidian API, Zod, YAML, Vitest, CodeMirror 6.

---

## Implementation

- [x] Add YAML V2 schemas and compatible legacy annotation/Cell readers.
- [x] Add Cell, Scene, Profile, Proposal and V2 cache Markdown protocols.
- [x] Add evidence validation, Proposal hashes, stale detection and safe paths.
- [x] Add complete Vault scaffold, generated Wikilink indexes and migration backups.
- [x] Preserve last valid cached records while Agent files are malformed.
- [x] Protect existing/shared block IDs during annotation deletion.
- [x] Add General, Annotations, Cells, Scenes, Profile and Proposals settings tabs.
- [x] Reuse one annotation table in the Dashboard and settings.
- [x] Add direct/confirmation write modes and opt-in preference memory.
- [x] Add independent root and TutorLite CI verification.

## Verification

- Run `pnpm check` from the repository root.
- Run `pnpm --dir TutorLite typecheck`.
- Run `pnpm --dir TutorLite test`.
- Run `pnpm --dir TutorLite build`.
- Install into `Tutor`, reload Obsidian, and manually verify all six settings tabs.
