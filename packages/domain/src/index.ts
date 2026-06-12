import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

export const vaultRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\0"), "Path contains a null byte")
  .refine((value) => !/^[A-Za-z]:[\\/]/.test(value), "Path must be Vault-relative")
  .refine((value) => !value.startsWith("/") && !value.startsWith("\\"), "Path must be Vault-relative")
  .refine(
    (value) => !value.replaceAll("\\", "/").split("/").includes(".."),
    "Path cannot leave the Vault"
  );

export const sourcePositionSchema = z.object({
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative()
});

export const annotationAnchorSchema = z
  .object({
    kind: z.enum(["range", "block"]),
    blockId: z.string().min(1),
    generatedBlockId: z.boolean().default(false),
    selectedText: z.string(),
    contextBefore: z.string(),
    contextAfter: z.string(),
    textHash: z.string().startsWith("sha256:"),
    start: sourcePositionSchema,
    end: sourcePositionSchema
  })
  .refine((anchor) => anchor.end.offset >= anchor.start.offset, {
    message: "Anchor end must not precede its start"
  });

export const reviewProviderSchema = z.enum(["opencode", "codex", "manual"]);
export const correctnessSchema = z.enum([
  "correct",
  "partially_correct",
  "incorrect",
  "uncertain"
]);

export const reviewFollowUpSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  createdAt: isoDateTime
});

export const agentReviewSchema = z.object({
  provider: reviewProviderSchema,
  correctness: correctnessSchema,
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)).default([]),
  weaknesses: z.array(z.string().min(1)).default([]),
  missingConcepts: z.array(z.string().min(1)).default([]),
  suggestedRevision: z.string().optional(),
  socraticQuestion: z.string().optional(),
  followUp: reviewFollowUpSchema.optional(),
  createdAt: isoDateTime
});

export const annotationStatusSchema = z.enum([
  "draft",
  "saved",
  "review_requested",
  "reviewed",
  "archived",
  "orphaned"
]);

export const annotationSchema = z.object({
  id: z.string().min(1),
  filePath: vaultRelativePathSchema,
  anchor: annotationAnchorSchema,
  userNote: z.object({
    content: z.string().min(1),
    createdAt: isoDateTime,
    updatedAt: isoDateTime
  }),
  status: annotationStatusSchema,
  review: agentReviewSchema.optional(),
  tags: z.array(z.string().min(1)).default([]),
  concepts: z.array(z.string().min(1)).default([]),
  memoryCellIds: z.array(z.string().min(1)).default([]),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
});

export const memoryCellSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "conceptual_understanding",
    "conceptual_weakness",
    "question",
    "learning_pattern",
    "review_item"
  ]),
  source: z.object({
    annotationId: z.string().optional(),
    filePath: vaultRelativePathSchema.optional()
  }),
  concept: z
    .object({
      name: z.string().min(1),
      domain: z.string().optional()
    })
    .optional(),
  summary: z.string().min(1),
  evidence: z.string().optional(),
  userUnderstanding: z.string().optional(),
  agentGuidance: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
});

export const recentLearningContextSchema = z.object({
  recentlyStudied: z.array(z.string()),
  activeConfusions: z.array(z.string()),
  highValueAnnotations: z.array(z.string()),
  suggestedAgentBehavior: z.array(z.string()),
  updatedAt: isoDateTime
});

export const permissionPolicySchema = z.object({
  allowPersistentReviewWrites: z.boolean().default(false),
  allowMemoryCellCreation: z.boolean().default(false),
  allowFullDocumentRead: z.boolean().default(false)
});

export const documentStrategySchema = z.enum([
  "full",
  "ordered-chunks",
  "progressive-search"
]);

export const documentProfileSchema = z.object({
  annotationId: z.string(),
  filePath: vaultRelativePathSchema,
  estimatedTokens: z.number().int().nonnegative(),
  strategy: documentStrategySchema,
  headingCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative()
});

export const documentOutlineItemSchema = z.object({
  id: z.string(),
  level: z.number().int().min(1).max(6),
  title: z.string(),
  line: z.number().int().nonnegative()
});

export const documentChunkSchema = z.object({
  id: z.string(),
  annotationId: z.string(),
  headingPath: z.array(z.string()),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  content: z.string()
});

export const documentSearchHitSchema = z.object({
  chunkId: z.string(),
  headingPath: z.array(z.string()),
  excerpt: z.string(),
  score: z.number().nonnegative()
});

export const agentRunSchema = z.object({
  id: z.string(),
  annotationId: z.string(),
  provider: reviewProviderSchema.exclude(["manual"]),
  status: z.enum(["queued", "running", "completed", "cancelled", "failed"]),
  error: z.string().optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
});

export const annotationQuerySchema = z.object({
  query: z.string().optional(),
  file: vaultRelativePathSchema.optional(),
  status: annotationStatusSchema.optional(),
  correctness: correctnessSchema.optional(),
  concept: z.string().optional(),
  tag: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0)
});

export type SourcePosition = z.infer<typeof sourcePositionSchema>;
export type AnnotationAnchor = z.infer<typeof annotationAnchorSchema>;
export type AgentReview = z.infer<typeof agentReviewSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type MemoryCell = z.infer<typeof memoryCellSchema>;
export type RecentLearningContext = z.infer<typeof recentLearningContextSchema>;
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;
export type DocumentProfile = z.infer<typeof documentProfileSchema>;
export type DocumentOutlineItem = z.infer<typeof documentOutlineItemSchema>;
export type DocumentChunk = z.infer<typeof documentChunkSchema>;
export type DocumentSearchHit = z.infer<typeof documentSearchHitSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AnnotationQuery = z.infer<typeof annotationQuerySchema>;

export class AnnotationTutorError extends Error {
  public constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "FORBIDDEN"
      | "CONFLICT"
      | "AGENT_UNAVAILABLE"
      | "AGENT_FAILED"
      | "AGENT_TIMEOUT"
      | "INTERNAL",
    message: string,
    public readonly status = 500
  ) {
    super(message);
    this.name = "AnnotationTutorError";
  }
}
