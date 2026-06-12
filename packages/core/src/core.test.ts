import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Annotation } from "@annotation-tutor/domain";
import {
  AnnotationStore,
  DocumentContextService,
  LearningContextStore,
  MemoryCellStore,
  PermissionService,
  resolveAnchor,
  VaultPaths
} from "./index.js";

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann-20260606-0001",
    filePath: "Papers/Attention.md",
    anchor: {
      kind: "range",
      blockId: "at-ann-20260606-0001",
      generatedBlockId: true,
      selectedText: "Multi-head attention",
      contextBefore: "The model uses ",
      contextAfter: " to combine information.",
      textHash: "sha256:placeholder",
      start: { line: 2, column: 0, offset: 20 },
      end: { line: 2, column: 20, offset: 40 }
    },
    userNote: {
      content: "Several perspectives are combined.",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z"
    },
    status: "saved",
    tags: ["transformer"],
    concepts: ["Attention"],
    memoryCellIds: [],
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
    ...overrides
  };
}

describe("VaultPaths", () => {
  it("keeps resolved source files inside the configured Vault", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-vault-"));
    const paths = new VaultPaths(vault);

    expect(paths.sourceFile("Notes/topic.md")).toBe(path.join(vault, "Notes", "topic.md"));
    expect(() => paths.sourceFile("../outside.md")).toThrow("outside the Vault");
  });
});

describe("generated learning files", () => {
  it("writes memory cells as Markdown with YAML frontmatter", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-memory-"));
    const paths = new VaultPaths(vault);
    const store = new MemoryCellStore(paths);
    const timestamp = "2026-06-06T10:00:00.000Z";

    const cell = {
      id: "mem-1",
      type: "conceptual_understanding",
      source: { annotationId: "ann-1", filePath: "Notes/topic.md" },
      concept: { name: "Attention", domain: "AI" },
      summary: "The learner understands the multi-view intuition.",
      confidence: 0.8,
      importance: 0.7,
      createdAt: timestamp,
      updatedAt: timestamp
    } as const;
    await store.save(cell);
    await store.save({ ...cell, summary: "Updated understanding." });

    const markdown = await readFile(path.join(paths.memoryCells, "mem-1.md"), "utf8");
    expect(markdown).toContain("type: conceptual_understanding");
    expect(markdown).toContain("# Attention");
    expect(markdown).toContain("Updated understanding.");
    expect((await store.list())[0]?.id).toBe("mem-1");
  });

  it("writes recent learning context as readable Markdown", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-context-"));
    const paths = new VaultPaths(vault);
    const store = new LearningContextStore(paths);

    await store.save({
      recentlyStudied: ["Attention"],
      activeConfusions: ["Q/K/V projections"],
      highValueAnnotations: ["ann-1"],
      suggestedAgentBehavior: ["Ask the learner to explain first."],
      updatedAt: "2026-06-06T10:00:00.000Z"
    });

    expect(await readFile(paths.learningContext, "utf8")).toContain(
      "## Active Confusions"
    );
  });
});

describe("AnnotationStore", () => {
  it("round-trips validated sidecar JSON and lists records", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-store-"));
    const store = new AnnotationStore(new VaultPaths(vault));
    const record = annotation();

    await store.save(record);
    const updated = {
      ...record,
      userNote: { ...record.userNote, content: "Updated note" }
    };
    await store.save(updated);

    expect(await store.get(record.id)).toEqual(updated);
    expect(await store.list()).toEqual([updated]);
  });
});

describe("PermissionService", () => {
  it("allows one requested review but rejects a second one without persistent permission", () => {
    const permissions = new PermissionService({
      allowPersistentReviewWrites: false,
      allowMemoryCellCreation: false,
      allowFullDocumentRead: false
    });

    expect(
      permissions.canWriteReview(annotation({ status: "review_requested" }))
    ).toBe(true);
    expect(
      permissions.canWriteReview(
        annotation({
          status: "reviewed",
          review: {
            provider: "opencode",
            correctness: "correct",
            summary: "Good explanation.",
            strengths: [],
            weaknesses: [],
            missingConcepts: [],
            createdAt: "2026-06-06T10:05:00.000Z"
          }
        })
      )
    ).toBe(false);
  });
});

describe("resolveAnchor", () => {
  it("resolves by block ID before considering fuzzy text", () => {
    const markdown = [
      "# Attention",
      "",
      "Multi-head attention combines projections. ^at-ann-20260606-0001",
      "",
      "Multi-head attention appears again."
    ].join("\n");

    const resolution = resolveAnchor(markdown, annotation().anchor);

    expect(resolution.strategy).toBe("block-id");
    expect(resolution.line).toBe(2);
    expect(resolution.confidence).toBe(1);
  });

  it("returns a repair suggestion instead of silently accepting a fuzzy match", () => {
    const markdown = "Multi head attention combines several learned projections.";
    const resolution = resolveAnchor(markdown, {
      ...annotation().anchor,
      blockId: "missing",
      selectedText: "Multi-head attention combines projections"
    });

    expect(resolution.strategy).toBe("fuzzy");
    expect(resolution.requiresConfirmation).toBe(true);
  });
});

describe("DocumentContextService", () => {
  it("profiles and reads only the source document belonging to an annotation", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-doc-"));
    const paths = new VaultPaths(vault);
    const store = new AnnotationStore(paths);
    const record = annotation();
    const sourcePath = paths.sourceFile(record.filePath);
    await store.save(record);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(
      sourcePath,
      "# Attention\n\n## Projections\n\nEach head uses learned projections.\n",
      { encoding: "utf8", flag: "w" }
    );
    const documents = new DocumentContextService(paths, store);

    const profile = await documents.getProfile(record.id);
    const outline = await documents.getOutline(record.id);
    const content = await documents.readContent(record.id);

    expect(profile.strategy).toBe("full");
    expect(outline.map((heading) => heading.title)).toEqual(["Attention", "Projections"]);
    expect(content.content).toContain("learned projections");
    expect(await readFile(sourcePath, "utf8")).toContain("# Attention");
  });

  it("uses ordered chunks for medium documents and progressive search for large documents", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-size-"));
    const paths = new VaultPaths(vault);
    const store = new AnnotationStore(paths);
    const record = annotation();
    await store.save(record);
    await mkdir(path.dirname(paths.sourceFile(record.filePath)), { recursive: true });
    const documents = new DocumentContextService(paths, store, {
      estimateTokens: (text) => text.length
    });

    await writeFile(paths.sourceFile(record.filePath), `# Medium\n${"x".repeat(30_001)}`, "utf8");
    expect((await documents.getProfile(record.id)).strategy).toBe("ordered-chunks");

    await writeFile(paths.sourceFile(record.filePath), `# Large\n${"x".repeat(60_001)}`, "utf8");
    expect((await documents.getProfile(record.id)).strategy).toBe("progressive-search");
    expect(
      (await documents.listChunks(record.id)).every(
        (chunk) => chunk.estimatedTokens <= 12_000
      )
    ).toBe(true);
  });

  it("rejects source documents that resolve outside the Vault through a link", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-link-vault-"));
    const outside = await mkdtemp(path.join(tmpdir(), "annotation-tutor-link-outside-"));
    await writeFile(path.join(outside, "secret.md"), "# Outside", "utf8");
    try {
      await symlink(outside, path.join(vault, "Linked"), "junction");
    } catch (error) {
      if (
        process.platform === "win32" &&
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EPERM"
      ) {
        return;
      }
      throw error;
    }
    const paths = new VaultPaths(vault);
    const store = new AnnotationStore(paths);
    const record = annotation({ filePath: "Linked/secret.md" });
    await store.save(record);

    await expect(
      new DocumentContextService(paths, store).readContent(record.id)
    ).rejects.toThrow("outside the Vault");
  });
});
