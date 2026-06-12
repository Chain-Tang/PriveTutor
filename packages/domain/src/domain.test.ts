import { describe, expect, it } from "vitest";
import {
  agentReviewSchema,
  annotationSchema,
  permissionPolicySchema
} from "./index.js";

describe("annotationSchema", () => {
  it("accepts a range annotation with a complete source anchor", () => {
    const annotation = annotationSchema.parse({
      id: "ann-20260606-0001",
      filePath: "Papers/Attention.md",
      anchor: {
        kind: "range",
        blockId: "at-ann-20260606-0001",
        generatedBlockId: true,
        selectedText: "Multi-head attention",
        contextBefore: "The model uses ",
        contextAfter: " in every layer.",
        textHash: "sha256:abc",
        start: { line: 12, column: 4, offset: 200 },
        end: { line: 12, column: 24, offset: 220 }
      },
      userNote: {
        content: "It examines several representation subspaces.",
        createdAt: "2026-06-06T10:00:00.000Z",
        updatedAt: "2026-06-06T10:00:00.000Z"
      },
      status: "saved",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z"
    });

    expect(annotation.anchor.kind).toBe("range");
  });

  it("rejects absolute and parent-relative Vault paths", () => {
    const base = {
      id: "ann-1",
      anchor: {
        kind: "block",
        blockId: "at-ann-1",
        generatedBlockId: true,
        selectedText: "",
        contextBefore: "",
        contextAfter: "",
        textHash: "sha256:abc",
        start: { line: 0, column: 0, offset: 0 },
        end: { line: 0, column: 0, offset: 0 }
      },
      userNote: {
        content: "note",
        createdAt: "2026-06-06T10:00:00.000Z",
        updatedAt: "2026-06-06T10:00:00.000Z"
      },
      status: "saved",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z"
    };

    expect(() => annotationSchema.parse({ ...base, filePath: "../secret.md" })).toThrow();
    expect(() => annotationSchema.parse({ ...base, filePath: "C:\\secret.md" })).toThrow();
  });
});

describe("agentReviewSchema", () => {
  it("allows at most one persisted follow-up", () => {
    const review = agentReviewSchema.parse({
      provider: "codex",
      correctness: "partially_correct",
      summary: "The intuition is useful but incomplete.",
      strengths: ["Identifies multiple perspectives."],
      weaknesses: ["Does not explain projections."],
      suggestedRevision: "Each head uses separate Q/K/V projections.",
      socraticQuestion: "Why are separate projections useful?",
      followUp: {
        question: "Are heads fully independent?",
        answer: "They are computed separately and combined.",
        createdAt: "2026-06-06T10:05:00.000Z"
      },
      createdAt: "2026-06-06T10:04:00.000Z"
    });

    expect(review.followUp?.question).toContain("independent");
  });
});

describe("permissionPolicySchema", () => {
  it("defaults all persistent Agent write capabilities to disabled", () => {
    const policy = permissionPolicySchema.parse({});

    expect(policy.allowPersistentReviewWrites).toBe(false);
    expect(policy.allowMemoryCellCreation).toBe(false);
    expect(policy.allowFullDocumentRead).toBe(false);
  });
});

