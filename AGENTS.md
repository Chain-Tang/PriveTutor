# Annotation Tutor

## Commands

- Install: `pnpm install`
- Type check: `pnpm typecheck`
- Test: `pnpm test`
- Build: `pnpm build`
- Install development plugin: `pnpm install:dev-plugin`

## Architecture

- TypeScript monorepo with shared domain and core services.
- Sidecar JSON and generated Markdown are authoritative. SQLite is a rebuildable index.
- REST and MCP handlers call the same core application service.
- The Obsidian plugin and standalone CLI are mutually exclusive write hosts for a Vault.
- Agent access to document content must begin with an annotation ID. Never expose an arbitrary Vault path.

## Boundaries

- Desktop-only Obsidian MVP.
- No cloud sync, vector database, generic chat, mobile plugin, or direct model API.
- Do not store API keys or provider credentials.
- Treat Agent and MCP payloads as untrusted input and validate with Zod.

