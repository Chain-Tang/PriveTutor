import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Annotation } from "@annotation-tutor/domain";
import {
  AnnotationIndexer,
  AnnotationStore,
  AnnotationTutorService,
  DocumentContextService,
  MemoryCellStore,
  PermissionService,
  VaultPaths
} from "./index.js";

function record(id: string, note: string, status: Annotation["status"] = "saved"): Annotation {
  const timestamp = "2026-06-06T10:00:00.000Z";
  return {
    id,
    filePath: "Notes/topic.md",
    anchor: {
      kind: "range",
      blockId: `at-${id}`,
      generatedBlockId: true,
      selectedText: "attention",
      contextBefore: "",
      contextAfter: "",
      textHash: "sha256:test",
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: 9, offset: 9 }
    },
    userNote: { content: note, createdAt: timestamp, updatedAt: timestamp },
    status,
    tags: ["transformer"],
    concepts: ["Attention"],
    memoryCellIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

describe("AnnotationIndexer", () => {
  it("rebuilds from sidecar JSON and supports filtered text queries", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-index-"));
    const paths = new VaultPaths(vault);
    const store = new AnnotationStore(paths);
    await store.save(record("ann-1", "Several learned projections."));
    await store.save(record("ann-2", "A different concept.", "archived"));
    const indexer = new AnnotationIndexer(paths);

    await indexer.rebuild(await store.list());
    const results = indexer.query({
      query: "projections",
      tag: "transformer",
      limit: 20,
      offset: 0
    });

    expect(results.map((item) => item.id)).toEqual(["ann-1"]);
    expect(indexer.query({ tag: "form", limit: 20, offset: 0 })).toEqual([]);
    indexer.close();
  });

  it("recovers a damaged derived index and serves document FTS results", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-recovery-"));
    const paths = new VaultPaths(vault);
    const store = new AnnotationStore(paths);
    const source = paths.sourceFile("Notes/topic.md");
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(path.dirname(paths.index), { recursive: true });
    await writeFile(paths.index, "not a sqlite database", "utf8");
    await writeFile(source, "# Topic\n\nEach head uses learned projections.", "utf8");
    await store.save(record("ann-1", "My note"));

    const indexer = new AnnotationIndexer(paths);
    await indexer.rebuild(await store.list());
    const documents = new DocumentContextService(paths, store, {}, indexer);
    const hits = await documents.search("ann-1", "learned projections");

    expect(indexer.query({ limit: 20, offset: 0 })).toEqual([{ id: "ann-1" }]);
    expect(hits[0]?.excerpt).toContain("learned projections");
    expect(hits[0]?.score).toBeGreaterThan(0);
    indexer.close();
  });

  it("rebuilds document sections during service initialization", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-doc-rebuild-"));
    const paths = new VaultPaths(vault);
    const store = new AnnotationStore(paths);
    const source = paths.sourceFile("Notes/topic.md");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "# Topic\n\nRebuild this searchable evidence.", "utf8");
    await store.save(record("ann-1", "My note"));
    const indexer = new AnnotationIndexer(paths);
    const service = new AnnotationTutorService({
      annotations: store,
      memoryCells: new MemoryCellStore(paths),
      documents: new DocumentContextService(paths, store, {}, indexer),
      indexer,
      permissions: new PermissionService()
    });

    await service.initialize();

    expect(indexer.searchDocument("Notes/topic.md", "searchable", 10)).toHaveLength(1);
    indexer.close();
  });
});

describe("AnnotationTutorService", () => {
  it("persists a permitted review and consumes the one-time request state", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-service-"));
    const paths = new VaultPaths(vault);
    await mkdir(path.dirname(paths.sourceFile("Notes/topic.md")), { recursive: true });
    const store = new AnnotationStore(paths);
    const indexer = new AnnotationIndexer(paths);
    const service = new AnnotationTutorService({
      annotations: store,
      memoryCells: new MemoryCellStore(paths),
      documents: new DocumentContextService(paths, store),
      indexer,
      permissions: new PermissionService()
    });
    await service.createAnnotation(record("ann-1", "My understanding", "review_requested"));

    const reviewed = await service.writeReview("ann-1", {
      provider: "opencode",
      correctness: "partially_correct",
      summary: "Useful intuition, but projections are missing.",
      strengths: ["Captures multiple perspectives."],
      weaknesses: ["Does not mention Q/K/V projections."],
      missingConcepts: ["Q/K/V projections"],
      createdAt: "2026-06-06T10:05:00.000Z"
    });

    expect(reviewed.status).toBe("reviewed");
    expect(reviewed.review?.provider).toBe("opencode");
    await expect(
      service.writeReview("ann-1", {
        provider: "codex",
        correctness: "correct",
        summary: "Second review",
        strengths: [],
        weaknesses: [],
        missingConcepts: [],
        createdAt: "2026-06-06T10:06:00.000Z"
      })
    ).rejects.toThrow("not permitted");
    indexer.close();
  });
});
