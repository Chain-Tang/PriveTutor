import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AnnotationTutorService } from "@annotation-tutor/core";
import {
  agentReviewSchema,
  memoryCellSchema,
  type Annotation
} from "@annotation-tutor/domain";

export function createAnnotationTutorMcpServer(
  service: AnnotationTutorService
): McpServer {
  const server = new McpServer(
    { name: "annotation-tutor", version: "0.1.0" },
    {
      instructions:
        "Start with get_recent_learning_context. Read source documents only through annotation IDs. Distinguish document evidence from model background knowledge. Write reviews only when the learner requested review."
    }
  );

  server.registerTool(
    "list_recent_annotations",
    {
      description: "List recently updated learning annotations.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20),
        days: z.number().int().min(1).max(365).default(7)
      },
      outputSchema: { annotations: z.array(z.record(z.string(), z.unknown())) },
      annotations: { readOnlyHint: true }
    },
    async ({ limit, days }) => {
      const cutoff = Date.now() - days * 86_400_000;
      const annotations = (await service.listAnnotations({ limit: 100, offset: 0 }))
        .filter((annotation) => Date.parse(annotation.updatedAt) >= cutoff)
        .slice(0, limit)
        .map(summary);
      return result({ annotations });
    }
  );

  server.registerTool(
    "search_annotations",
    {
      description: "Search annotation text, learner notes, reviews, tags, and concepts.",
      inputSchema: {
        query: z.string().min(1),
        status: z
          .enum(["draft", "saved", "review_requested", "reviewed", "archived", "orphaned"])
          .optional(),
        correctness: z
          .enum(["correct", "partially_correct", "incorrect", "uncertain"])
          .optional(),
        limit: z.number().int().min(1).max(100).default(10)
      },
      annotations: { readOnlyHint: true }
    },
    async ({ query, status, correctness, limit }) =>
      result({
        annotations: (
          await service.listAnnotations({
            query,
            status,
            correctness,
            limit,
            offset: 0
          })
        ).map(summary)
      })
  );

  server.registerTool(
    "get_annotation_detail",
    {
      description: "Get a full annotation, review, and linked learning memory.",
      inputSchema: { annotationId: z.string().min(1) },
      annotations: { readOnlyHint: true }
    },
    async ({ annotationId }) =>
      result({ annotation: await service.getAnnotation(annotationId) })
  );

  server.registerTool(
    "get_recent_learning_context",
    {
      description: "Get a compact summary of recent concepts and active confusions.",
      annotations: { readOnlyHint: true }
    },
    async () => result(await service.getRecentLearningContext())
  );

  server.registerTool(
    "write_agent_review",
    {
      description: "Write a structured review when the annotation permits a review.",
      inputSchema: {
        annotationId: z.string().min(1),
        review: agentReviewSchema
      },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ annotationId, review }) =>
      result({ annotation: await service.writeReview(annotationId, review) })
  );

  server.registerTool(
    "create_memory_cell",
    {
      description: "Create durable learning memory when the user enabled this permission.",
      inputSchema: { memoryCell: memoryCellSchema },
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    async ({ memoryCell }) =>
      result({ memoryCell: await service.createMemoryCell(memoryCell) })
  );

  server.registerTool(
    "get_document_profile",
    {
      description: "Get source document size and the required reading strategy.",
      inputSchema: { annotationId: z.string().min(1) },
      annotations: { readOnlyHint: true }
    },
    async ({ annotationId }) =>
      result(await service.documents.getProfile(annotationId))
  );

  server.registerTool(
    "get_document_outline",
    {
      description: "Get the heading outline for an annotation's source document.",
      inputSchema: { annotationId: z.string().min(1) },
      annotations: { readOnlyHint: true }
    },
    async ({ annotationId }) => {
      const chunks = await service.documents.listChunks(annotationId);
      return result({
        outline: await service.documents.getOutline(annotationId),
        chunks: chunks.map(({ content: _content, ...metadata }) => metadata)
      });
    }
  );

  server.registerTool(
    "read_document_chunk",
    {
      description:
        "Read one heading-aware source chunk. Obtain chunk IDs from the document outline workflow.",
      inputSchema: {
        annotationId: z.string().min(1),
        chunkId: z.string().min(1)
      },
      annotations: { readOnlyHint: true }
    },
    async ({ annotationId, chunkId }) => {
      requireDocumentPermission(service);
      return result(await service.documents.readChunk(annotationId, chunkId));
    }
  );

  server.registerTool(
    "search_document",
    {
      description:
        "Search only the source document belonging to the supplied annotation ID.",
      inputSchema: {
        annotationId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10)
      },
      annotations: { readOnlyHint: true }
    },
    async ({ annotationId, query, limit }) => {
      requireDocumentPermission(service);
      return result({ hits: await service.documents.search(annotationId, query, limit) });
    }
  );

  return server;
}

function summary(annotation: Annotation): Record<string, unknown> {
  return {
    id: annotation.id,
    filePath: annotation.filePath,
    selectedText: annotation.anchor.selectedText,
    userNote: annotation.userNote.content,
    status: annotation.status,
    correctness: annotation.review?.correctness,
    concepts: annotation.concepts,
    updatedAt: annotation.updatedAt
  };
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>
  };
}

function requireDocumentPermission(service: AnnotationTutorService): void {
  if (!service.permissions.canReadFullDocument()) {
    throw new Error("Full source document access is disabled");
  }
}
