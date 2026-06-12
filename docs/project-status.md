# Annotation Tutor Project Status

**Snapshot date:** 2026-06-07

## Overall Status

The root TypeScript workspace is a core-MVP candidate at the implementation and
automated-test level. It is not release-ready yet because the full Obsidian
workflow and real OpenCode/Codex integrations have not been accepted end to
end, and several broader product-spec UI flows remain incomplete.

`TutorLite` remains a separate Markdown-only sibling project. It is not part of
the pnpm workspace. Root Vitest explicitly excludes it, and CI runs its own
typecheck, tests, and build as separate gates.

## Implemented

### Data and Core

- Zod-validated annotation, review, memory-cell, permission, document, query,
  and Agent-run schemas.
- Atomic sidecar JSON writes for annotations.
- Markdown memory cells with YAML frontmatter.
- Generated `Agent Context/recent-learning.md`.
- Rebuildable SQLite index with annotation FTS5, filters, memory-cell rows, and
  document-section FTS5.
- Block-ID, exact-text, context, fuzzy-confirmation, and orphaned anchor flows.
- Annotation-ID-first source access with schema, path-resolution, and
  `realpath` containment checks.
- Heading-aware document profiles and chunking:
  - up to 30k estimated tokens: `full`
  - 30k-60k: `ordered-chunks`
  - over 60k: `progressive-search`

### Service, REST, and MCP

- One shared `AnnotationTutorService` behind REST and MCP.
- Local Hono server bound to `127.0.0.1`.
- Separate admin and Agent-scoped bearer tokens; Agent writes remain
  permission-gated.
- Browser-origin rejection for authenticated API and MCP requests.
- Annotation CRUD, review deletion, one persisted follow-up, memory-cell CRUD,
  learning context, Markdown export, permissions, host release, and document
  access endpoints.
- SSE review progress, cancellation, structured result validation, and review
  persistence.
- Ten MCP tools:
  - `list_recent_annotations`
  - `search_annotations`
  - `get_annotation_detail`
  - `get_recent_learning_context`
  - `write_agent_review`
  - `create_memory_cell`
  - `get_document_profile`
  - `get_document_outline`
  - `read_document_chunk`
  - `search_document`
- Permission gates for full-document reads, persistent review writes, and
  memory-cell creation.
- Plugin/CLI mutual exclusion through a Vault write-host lease.

### Agent and CLI

- OpenCode SDK bridge with file editing, shell, and direct MCP write tools
  disabled during automatic reviews.
- Codex `app-server` JSON-RPC bridge with a read-only sandbox, structured output,
  cancellation, and no provider fallback.
- OpenCode and Codex configuration generation.
- CLI commands: `doctor`, `setup opencode`, `setup codex`, `start`, `serve`,
  `stop`, `status`, `export`, and `rebuild-index`.

### Obsidian Plugin

- Desktop-only manifest and development installer.
- Embedded service host with fallback/reconnection to a CLI-owned host.
- Create range or block annotations from the editor and context menu.
- Generated Obsidian block IDs and safe cleanup when deleting annotations.
- CodeMirror range underlines and block markers.
- Dashboard search and filters for status, document, concept, review state, and
  creation time.
- Open, edit, review, follow up once, delete review, and delete annotation
  actions.
- Fuzzy anchor repair confirmation.
- First-run choices for annotations only, OpenCode, Codex, and developer mode.
- Settings for provider and all three permission gates.
- English and Chinese UI dictionaries with English fallback.

### TutorLite Memory Library

- YAML V2 Annotation, Cell, Scene, Learner Profile, Preferences, and Proposal
  Markdown protocols with legacy Annotation and `MEM-*` readers.
- Vault-local `Agent Memory/` scaffold with generated Wikilink indexes and a
  Zod-validated, rebuildable V2 JSON cache.
- Evidence-backed Cells and auditable Profile claims; Scene membership derives
  Cell backlinks and source annotations.
- Direct Agent writes or confirmation-mode Proposal review with SHA-256 stale
  detection and managed-path validation.
- Six-tab settings management center while retaining the existing annotation
  editor, margin comments, detail popover, and standalone Dashboard.
- Safe generated/shared block-ID cleanup, migration backups, malformed-file
  diagnostics, and last-valid cache retention.

## Verification

The following commands passed on Windows on 2026-06-07:

```text
pnpm check
  typecheck: passed
  tests: 8 files, 43 tests passed
  build: Obsidian plugin and CLI passed

pnpm --dir TutorLite typecheck
pnpm --dir TutorLite test
  18 files, 76 tests passed
pnpm --dir TutorLite build
```

Root TypeScript checking, tests, and builds do not validate the separate
`TutorLite` project, so its three commands are run explicitly in local release
checks and CI.

CI is configured to run both project gates on Linux, Windows, and macOS, but
this snapshot does not include a completed remote CI run.

## Acceptance Status

| MVP outcome | Status |
| --- | --- |
| Create, persist, render, list, edit, and delete annotations | Implemented; real Obsidian acceptance pending |
| Jump to source and repair moved anchors | Implemented; real Obsidian acceptance pending |
| Authenticated REST and MCP access | Implemented and covered by automated tests |
| OpenCode review and write-back | Implemented with mocked runtime coverage; real provider acceptance pending |
| Codex review and write-back | Implemented with fake app-server coverage; real provider acceptance pending |
| Generated recent-learning context | Implemented and covered by automated tests |
| No model API keys stored | Implemented by architecture |
| Delete generated reviews | Implemented through the service/API |
| Memory cells | Storage and REST/MCP core implemented; no complete plugin UI workflow |
| Beginner developer mode | Choice exists; API guidance UI is not implemented |

## Current Gaps and Risks

1. **No Git baseline.** The branch `feature/annotation-tutor-mvp` has no commits,
   and all repository files are currently untracked. There is no recoverable
   implementation history until an initial commit is created.
2. **Manual acceptance is incomplete.** The 15 MVP criteria have not been
   exercised as one real Obsidian workflow with an authenticated provider.
3. **The full plugin is not enabled in the development Vault.** Its build is
   installed under `.obsidian/plugins/annotation-tutor`, but
   `Tutor/.obsidian/community-plugins.json` currently enables only
   `annotation-tutor-lite`.
4. **Memory-cell UI is incomplete.** The backend supports memory-cell CRUD and
   annotation backlinks, but the plugin does not yet present a full create,
   browse, edit, or delete workflow.
5. **Concept and tag authoring is API-only.** The dashboard can filter them, but
   newly created annotations start with empty arrays and the plugin has no
   editor for these fields.
6. **Generated Codex Vault config is read-only.** It enables annotation and
   document reading tools but omits direct MCP write tools. Automatic plugin
   reviews still persist through the host service.
7. **No OpenAPI document.** REST exists, but the broad original design's
   OpenAPI/SDK goal is not part of the implemented MVP.
8. **No Claude Code integration.** This is an explicit current non-goal, despite
   references in the older broad design specification.

## Next Release Gates

1. Create an initial Git commit after reviewing generated and ignored files.
2. Enable the full plugin in `Tutor` and execute the 15 acceptance criteria.
3. Run one real OpenCode review and one real Codex review, including cancellation
   and follow-up.
4. Decide whether memory-cell management and concept/tag editing are required
   for `0.1.0` or should be documented as post-MVP.
5. Confirm CI passes on all three configured operating systems.
