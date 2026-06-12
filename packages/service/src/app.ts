import { streamSSE } from "hono/streaming";
import { Hono, type MiddlewareHandler } from "hono";
import {
  AnnotationTutorError,
  agentReviewSchema,
  annotationQuerySchema,
  annotationSchema,
  memoryCellSchema,
  permissionPolicySchema,
  reviewFollowUpSchema,
  type PermissionPolicy
} from "@annotation-tutor/domain";
import type { AnnotationTutorService } from "@annotation-tutor/core";
import type { ReviewRunManager } from "./review-runs.js";

type ApiRole = "admin" | "agent";

type ApiAppOptions = {
  service: AnnotationTutorService;
  version: string;
  vaultName: string;
  tokens: {
    admin: string;
    agentReadOnly: string;
  };
  reviewRuns?: ReviewRunManager;
  mcpHandler?: (request: Request) => Promise<Response>;
  followUp?: (
    annotationId: string,
    provider: "opencode" | "codex",
    question: string,
    signal: AbortSignal
  ) => Promise<string>;
  releaseHost?: () => void;
  permissionsUpdated?: (policy: PermissionPolicy) => Promise<void>;
};

type Variables = {
  role: ApiRole;
};

export function createApiApp(options: ApiAppOptions): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();
  options.reviewRuns?.onReview(async (request, review) => {
    await options.service.writeReview(request.annotationId, review);
  });

  app.onError((error, context) => {
    if (error instanceof AnnotationTutorError) {
      return context.json({ error: error.code, message: error.message }, error.status as 400);
    }
    if (error instanceof Error && error.name === "ZodError") {
      return context.json({ error: "INVALID_INPUT", message: error.message }, 400);
    }
    console.error(error);
    return context.json({ error: "INTERNAL", message: "Internal server error" }, 500);
  });

  app.get("/api/health", (context) =>
    context.json({ ok: true, version: options.version })
  );

  app.use("/api/*", async (context, next) => {
    if (context.req.path === "/api/health") {
      return next();
    }
    if (context.req.header("origin")) {
      throw new AnnotationTutorError(
        "FORBIDDEN",
        "Browser-origin requests are not accepted",
        403
      );
    }
    const authorization = context.req.header("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (token === options.tokens.admin) {
      context.set("role", "admin");
    } else if (token === options.tokens.agentReadOnly) {
      context.set("role", "agent");
    } else {
      return context.json({ error: "UNAUTHORIZED", message: "Invalid bearer token" }, 401);
    }
    await next();
  });

  if (options.mcpHandler) {
    app.all("/mcp", async (context) => {
      if (context.req.header("origin")) {
        throw new AnnotationTutorError(
          "FORBIDDEN",
          "Browser-origin requests are not accepted",
          403
        );
      }
      const token = context.req
        .header("authorization")
        ?.replace(/^Bearer\s+/i, "");
      if (token !== options.tokens.agentReadOnly) {
        return context.json(
          { error: "UNAUTHORIZED", message: "Invalid Agent bearer token" },
          401
        );
      }
      return options.mcpHandler!(context.req.raw);
    });
  }

  app.get("/api/annotations", async (context) => {
    const query = annotationQuerySchema.parse(context.req.query());
    return context.json({ annotations: await options.service.listAnnotations(query) });
  });
  app.get("/api/annotations/:id", async (context) =>
    context.json(await options.service.getAnnotation(context.req.param("id")))
  );
  app.post("/api/annotations", requireAdmin, async (context) =>
    context.json(
      await options.service.createAnnotation(annotationSchema.parse(await context.req.json())),
      201
    )
  );
  app.patch("/api/annotations/:id", requireAdmin, async (context) =>
    context.json(
      await options.service.updateAnnotation(
        context.req.param("id"),
        (await context.req.json()) as Record<string, unknown>
      )
    )
  );
  app.delete("/api/annotations/:id", requireAdmin, async (context) => {
    await options.service.deleteAnnotation(context.req.param("id"));
    return context.body(null, 204);
  });
  app.post("/api/annotations/:id/review", requireAdmin, async (context) =>
    context.json(
      await options.service.writeReview(
        context.req.param("id"),
        agentReviewSchema.parse(await context.req.json())
      )
    )
  );
  app.delete("/api/annotations/:id/review", requireAdmin, async (context) =>
    context.json(await options.service.deleteReview(context.req.param("id")))
  );
  app.post("/api/annotations/:id/review/follow-up", requireAdmin, async (context) =>
    {
      if (!options.followUp) {
        throw new AnnotationTutorError(
          "AGENT_UNAVAILABLE",
          "Agent follow-up is not configured",
          503
        );
      }
      const input = zFollowUpRequest.parse(await context.req.json());
      const answer = await options.followUp(
        context.req.param("id"),
        input.provider,
        input.question,
        context.req.raw.signal
      );
      return context.json(
        await options.service.saveFollowUp(
          context.req.param("id"),
          reviewFollowUpSchema.parse({
            question: input.question,
            answer,
            createdAt: new Date().toISOString()
          })
        )
      );
    }
  );

  app.get("/api/annotations/:id/document/profile", async (context) =>
    context.json(await options.service.documents.getProfile(context.req.param("id")))
  );
  app.get("/api/annotations/:id/document/outline", async (context) =>
    context.json(await options.service.documents.getOutline(context.req.param("id")))
  );
  app.get("/api/annotations/:id/document/content", async (context) => {
    requireFullDocumentRead(options.service);
    return context.json(await options.service.documents.readContent(context.req.param("id")));
  });
  app.get("/api/annotations/:id/document/chunks", async (context) => {
    requireFullDocumentRead(options.service);
    return context.json({
      chunks: await options.service.documents.listChunks(context.req.param("id"))
    });
  });
  app.get("/api/annotations/:id/document/chunks/:chunkId", async (context) => {
    requireFullDocumentRead(options.service);
    return context.json(
      await options.service.documents.readChunk(
        context.req.param("id"),
        context.req.param("chunkId")
      )
    );
  });
  app.get("/api/annotations/:id/document/search", async (context) => {
    requireFullDocumentRead(options.service);
    return context.json({
      hits: await options.service.documents.search(
        context.req.param("id"),
        context.req.query("query") ?? "",
        Number(context.req.query("limit") ?? 10)
      )
    });
  });

  app.get("/api/memory-cells", async (context) =>
    context.json({ memoryCells: await options.service.listMemoryCells() })
  );
  app.get("/api/memory-cells/:id", async (context) =>
    context.json(await options.service.getMemoryCell(context.req.param("id")))
  );
  app.get("/api/learning-context", async (context) =>
    context.json(await options.service.getRecentLearningContext())
  );
  app.post("/api/memory-cells", requireAdmin, async (context) =>
    context.json(
      await options.service.createMemoryCell(
        memoryCellSchema.parse(await context.req.json())
      ),
      201
    )
  );
  app.patch("/api/memory-cells/:id", requireAdmin, async (context) =>
    context.json(
      await options.service.updateMemoryCell(
        context.req.param("id"),
        memoryCellSchema.partial().parse(await context.req.json())
      )
    )
  );
  app.delete("/api/memory-cells/:id", requireAdmin, async (context) => {
    await options.service.deleteMemoryCell(context.req.param("id"));
    return context.body(null, 204);
  });
  app.get("/api/export/markdown", requireAdmin, async (context) =>
    context.text(await options.service.exportMarkdown())
  );
  app.get("/api/permissions", requireAdmin, (context) =>
    context.json(options.service.permissions.getPolicy())
  );
  app.patch("/api/permissions", requireAdmin, async (context) => {
    const policy = options.service.permissions.updatePolicy(
      permissionPolicySchema.partial().parse(await context.req.json())
    );
    await options.permissionsUpdated?.(policy);
    return context.json(policy);
  });
  app.post("/api/host/release", requireAdmin, (context) => {
    if (!options.releaseHost) {
      throw new AnnotationTutorError(
        "CONFLICT",
        "This service host cannot be released remotely",
        409
      );
    }
    options.releaseHost();
    return context.json({ accepted: true }, 202);
  });

  app.post("/api/annotations/:id/review-runs", requireAdmin, async (context) => {
    if (!options.reviewRuns) {
      throw new AnnotationTutorError(
        "AGENT_UNAVAILABLE",
        "No Agent review runner is configured",
        503
      );
    }
    const input = (await context.req.json()) as { provider?: unknown };
    if (input.provider !== "opencode" && input.provider !== "codex") {
      throw new AnnotationTutorError("INVALID_INPUT", "Unknown Agent provider", 400);
    }
    const run = options.reviewRuns.start({
      annotationId: context.req.param("id"),
      provider: input.provider
    });
    return context.json(run, 202);
  });

  app.get("/api/review-runs/:id/events", async (context) => {
    if (!options.reviewRuns) {
      throw new AnnotationTutorError("NOT_FOUND", "Review runner not configured", 404);
    }
    const id = context.req.param("id");
    const existing = options.reviewRuns.events(id);
    const run = options.reviewRuns.get(id);
    if (["completed", "cancelled", "failed"].includes(run.status)) {
      return context.text(
        existing
          .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          .join(""),
        200,
        { "content-type": "text/event-stream" }
      );
    }
    return streamSSE(context, async (stream) => {
      for (const event of existing) {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      }
      await new Promise<void>((resolve) => {
        let pendingWrite = Promise.resolve();
        const unsubscribe = options.reviewRuns!.subscribe(id, (event) => {
          pendingWrite = pendingWrite.then(() =>
            stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
          );
          if (
            event.type === "status" &&
            ["completed", "cancelled", "failed"].includes(event.status)
          ) {
            unsubscribe();
            void pendingWrite.finally(resolve);
          }
        });
      });
    });
  });

  app.delete("/api/review-runs/:id", requireAdmin, (context) => {
    if (!options.reviewRuns) {
      throw new AnnotationTutorError("NOT_FOUND", "Review runner not configured", 404);
    }
    return context.json(options.reviewRuns.cancel(context.req.param("id")));
  });

  return app;
}

const zFollowUpRequest = {
  parse(value: unknown): { provider: "opencode" | "codex"; question: string } {
    if (
      typeof value !== "object" ||
      value === null ||
      !("provider" in value) ||
      !("question" in value) ||
      ((value as { provider: unknown }).provider !== "opencode" &&
        (value as { provider: unknown }).provider !== "codex") ||
      typeof (value as { question: unknown }).question !== "string" ||
      !(value as { question: string }).question.trim()
    ) {
      throw new AnnotationTutorError(
        "INVALID_INPUT",
        "A provider and non-empty follow-up question are required",
        400
      );
    }
    return value as { provider: "opencode" | "codex"; question: string };
  }
};

const requireAdmin: MiddlewareHandler<{ Variables: Variables }> = async (
  context,
  next
) => {
  if (context.get("role") !== "admin") {
    throw new AnnotationTutorError("FORBIDDEN", "This operation requires admin access", 403);
  }
  await next();
};

function requireFullDocumentRead(service: AnnotationTutorService): void {
  if (!service.permissions.canReadFullDocument()) {
    throw new AnnotationTutorError(
      "FORBIDDEN",
      "Full source document access is disabled",
      403
    );
  }
}
