import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AnnotationIndexer,
  AnnotationStore,
  AnnotationTutorService,
  DocumentContextService,
  HostLease,
  MemoryCellStore,
  PermissionService,
  VaultPaths
} from "@annotation-tutor/core";
import type { AgentReview, Annotation } from "@annotation-tutor/domain";
import {
  AnnotationTutorApiClient,
  createApiApp,
  ReviewRunManager,
  startHostedRuntime
} from "./index.js";

async function fixture(allowFullDocumentRead = true) {
  const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-api-"));
  const paths = new VaultPaths(vault);
  const annotations = new AnnotationStore(paths);
  const indexer = new AnnotationIndexer(paths);
  const permissions = new PermissionService({ allowFullDocumentRead });
  const service = new AnnotationTutorService({
    annotations,
    memoryCells: new MemoryCellStore(paths),
    documents: new DocumentContextService(paths, annotations),
    indexer,
    permissions
  });
  const timestamp = "2026-06-06T10:00:00.000Z";
  const annotation: Annotation = {
    id: "ann-1",
    filePath: "Notes/topic.md",
    anchor: {
      kind: "range",
      blockId: "at-ann-1",
      generatedBlockId: true,
      selectedText: "attention",
      contextBefore: "",
      contextAfter: "",
      textHash: "sha256:test",
      start: { line: 2, column: 0, offset: 10 },
      end: { line: 2, column: 9, offset: 19 }
    },
    userNote: {
      content: "It uses multiple perspectives.",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    status: "review_requested",
    tags: [],
    concepts: [],
    memoryCellIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await mkdir(path.dirname(paths.sourceFile(annotation.filePath)), { recursive: true });
  await writeFile(paths.sourceFile(annotation.filePath), "# Topic\n\nAttention uses projections.", "utf8");
  await service.createAnnotation(annotation);
  return { vault, paths, service, indexer };
}

describe("createApiApp", () => {
  it("publishes minimal health without authentication and protects data routes", async () => {
    const { service, indexer } = await fixture();
    const app = createApiApp({
      service,
      version: "0.1.0",
      vaultName: "Test Vault",
      tokens: { admin: "admin-secret", agentReadOnly: "agent-secret" }
    });

    const health = await app.request("/api/health");
    const unauthenticated = await app.request("/api/annotations");
    const browserOrigin = await app.request("/api/annotations", {
      headers: {
        authorization: "Bearer admin-secret",
        origin: "https://example.test"
      }
    });

    expect(await health.json()).toEqual({ ok: true, version: "0.1.0" });
    expect(unauthenticated.status).toBe(401);
    expect(browserOrigin.status).toBe(403);
    indexer.close();
  });

  it("lets the Agent token read by annotation ID but never mutate records", async () => {
    const { service, indexer } = await fixture();
    const app = createApiApp({
      service,
      version: "0.1.0",
      vaultName: "Test Vault",
      tokens: { admin: "admin-secret", agentReadOnly: "agent-secret" }
    });
    const headers = { authorization: "Bearer agent-secret" };

    const detail = await app.request("/api/annotations/ann-1", { headers });
    const document = await app.request("/api/annotations/ann-1/document/content", {
      headers
    });
    const mutation = await app.request("/api/annotations/ann-1", {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ status: "archived" })
    });

    expect(detail.status).toBe(200);
    expect((await document.json()).content).toContain("projections");
    expect(mutation.status).toBe(403);
    indexer.close();
  });

  it("streams review progress and persists a valid structured review", async () => {
    const { service, indexer } = await fixture();
    const review: AgentReview = {
      provider: "opencode",
      correctness: "partially_correct",
      summary: "The intuition is useful but missing learned projections.",
      strengths: ["Mentions multiple perspectives."],
      weaknesses: ["Omits Q/K/V projections."],
      missingConcepts: ["Q/K/V projections"],
      createdAt: "2026-06-06T10:10:00.000Z"
    };
    const runs = new ReviewRunManager(async (_request, emit) => {
      emit({ type: "progress", message: "Reading the source document" });
      return review;
    });
    const app = createApiApp({
      service,
      version: "0.1.0",
      vaultName: "Test Vault",
      tokens: { admin: "admin-secret", agentReadOnly: "agent-secret" },
      reviewRuns: runs
    });
    const response = await app.request("/api/annotations/ann-1/review-runs", {
      method: "POST",
      headers: {
        authorization: "Bearer admin-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ provider: "opencode" })
    });
    const run = (await response.json()) as { id: string };
    await runs.wait(run.id);
    const events = await app.request(`/api/review-runs/${run.id}/events`, {
      headers: { authorization: "Bearer admin-secret" }
    });

    const eventText = await events.text();
    expect(eventText).toContain("Reading the source document");
    expect(eventText).toContain('"status":"completed"');
    expect((await service.getAnnotation("ann-1")).review?.provider).toBe("opencode");
    expect(runs.cancel(run.id).status).toBe("completed");
    const removedReview = await app.request("/api/annotations/ann-1/review", {
      method: "DELETE",
      headers: { authorization: "Bearer admin-secret" }
    });
    expect((await removedReview.json()).review).toBeUndefined();
    indexer.close();
  });

  it("cancels an in-flight review without later changing it to completed", async () => {
    const { service, indexer } = await fixture();
    const runs = new ReviewRunManager(
      (_request, _emit, signal) =>
        new Promise<AgentReview>((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                provider: "codex",
                correctness: "uncertain",
                summary: "Cancelled result",
                strengths: [],
                weaknesses: [],
                missingConcepts: [],
                createdAt: "2026-06-06T10:10:00.000Z"
              }),
            { once: true }
          );
        })
    );
    const app = createApiApp({
      service,
      version: "0.1.0",
      vaultName: "Test Vault",
      tokens: { admin: "admin-secret", agentReadOnly: "agent-secret" },
      reviewRuns: runs
    });
    const response = await app.request("/api/annotations/ann-1/review-runs", {
      method: "POST",
      headers: {
        authorization: "Bearer admin-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ provider: "codex" })
    });
    const run = (await response.json()) as { id: string };
    await Promise.resolve();

    const cancelled = await app.request(`/api/review-runs/${run.id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer admin-secret" }
    });
    await runs.wait(run.id);

    expect((await cancelled.json()).status).toBe("cancelled");
    expect(runs.get(run.id).status).toBe("cancelled");
    expect((await service.getAnnotation("ann-1")).review).toBeUndefined();
    indexer.close();
  });

  it("persists permission changes through the host callback", async () => {
    const { service, indexer } = await fixture(false);
    let persisted = service.permissions.getPolicy();
    const app = createApiApp({
      service,
      version: "0.1.0",
      vaultName: "Test Vault",
      tokens: { admin: "admin-secret", agentReadOnly: "agent-secret" },
      permissionsUpdated: async (policy) => {
        persisted = policy;
      }
    });

    const response = await app.request("/api/permissions", {
      method: "PATCH",
      headers: {
        authorization: "Bearer admin-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ allowFullDocumentRead: true })
    });

    expect(response.status).toBe(200);
    expect(persisted.allowFullDocumentRead).toBe(true);
    indexer.close();
  });

  it("supports Memory Cell CRUD and maintains annotation back-links", async () => {
    const { service, indexer } = await fixture();
    service.permissions.updatePolicy({ allowMemoryCellCreation: true });
    const app = createApiApp({
      service,
      version: "0.1.0",
      vaultName: "Test Vault",
      tokens: { admin: "admin-secret", agentReadOnly: "agent-secret" }
    });
    const headers = {
      authorization: "Bearer admin-secret",
      "content-type": "application/json"
    };
    const timestamp = "2026-06-06T10:20:00.000Z";
    const created = await app.request("/api/memory-cells", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: "mem-1",
        type: "conceptual_understanding",
        source: { annotationId: "ann-1", filePath: "Notes/topic.md" },
        concept: { name: "Attention" },
        summary: "Initial memory",
        createdAt: timestamp,
        updatedAt: timestamp
      })
    });
    expect((await service.getAnnotation("ann-1")).memoryCellIds).toEqual(["mem-1"]);
    const fetched = await app.request("/api/memory-cells/mem-1", { headers });
    const updated = await app.request("/api/memory-cells/mem-1", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ summary: "Updated memory" })
    });
    const removed = await app.request("/api/memory-cells/mem-1", {
      method: "DELETE",
      headers
    });

    expect(created.status).toBe(201);
    expect((await fetched.json()).summary).toBe("Initial memory");
    expect((await updated.json()).summary).toBe("Updated memory");
    expect(removed.status).toBe(204);
    expect((await service.getAnnotation("ann-1")).memoryCellIds).toEqual([]);
    await expect(service.getMemoryCell("mem-1")).rejects.toThrow("not found");
    indexer.close();
  });
});

describe("HostLease", () => {
  it("prevents concurrent write hosts and permits takeover after release", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-lease-"));
    const paths = new VaultPaths(vault);
    const plugin = new HostLease(paths, "plugin");
    const cli = new HostLease(paths, "cli");

    await plugin.acquire();
    await expect(cli.acquire()).rejects.toThrow("already owned");
    await plugin.release();
    await cli.acquire();

    expect(await cli.current()).toMatchObject({ owner: "cli" });
    await cli.release();
  });

  it("allows plugin release, CLI takeover, and persisted permission reload", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-takeover-"));
    await mkdir(path.join(vault, ".obsidian"), { recursive: true });
    const plugin = await startHostedRuntime({
      vaultRoot: vault,
      owner: "plugin",
      preferredPort: 43_000 + Math.floor(Math.random() * 1_000),
      enableOpenCode: false,
      enableCodex: false
    });
    const client = new AnnotationTutorApiClient(
      `http://127.0.0.1:${plugin.state.port}`,
      plugin.tokens.admin
    );
    await client.updatePermissions({ allowFullDocumentRead: true });

    const release = await fetch(
      `http://127.0.0.1:${plugin.state.port}/api/host/release`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${plugin.tokens.admin}` }
      }
    );
    expect(release.status).toBe(202);
    await waitUntil(async () => !(await new HostLease(plugin.paths, "cli").current()));

    const cli = await startHostedRuntime({
      vaultRoot: vault,
      owner: "cli",
      preferredPort: plugin.state.port,
      enableOpenCode: false,
      enableCodex: false
    });
    try {
      expect(cli.state.owner).toBe("cli");
      expect(cli.service.permissions.getPolicy().allowFullDocumentRead).toBe(true);
    } finally {
      await cli.close();
      await plugin.close();
    }
  });
});

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition");
}
