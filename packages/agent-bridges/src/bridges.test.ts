import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  AgentBridgeRegistry,
  CodexBridge,
  OpenCodeBridge,
  buildReviewPrompt,
  parseAgentReview,
  parseFollowUpAnswer
} from "./index.js";

const validReview = {
  correctness: "partially_correct",
  summary: "The intuition is useful but incomplete.",
  strengths: ["Recognizes multiple perspectives."],
  weaknesses: ["Omits learned projections."],
  missingConcepts: ["Q/K/V projections"],
  suggestedRevision: "Each head uses separate learned Q/K/V projections.",
  socraticQuestion: "Why would every head use different projections?"
};

describe("parseAgentReview", () => {
  it("extracts a validated review from fenced JSON", () => {
    const review = parseAgentReview(
      `Here is the review:\n\`\`\`json\n${JSON.stringify(validReview)}\n\`\`\``,
      "opencode",
      "2026-06-06T10:00:00.000Z"
    );

    expect(review.provider).toBe("opencode");
    expect(review.correctness).toBe("partially_correct");
  });

  it("rejects prose that does not contain the required structured result", () => {
    expect(() =>
      parseAgentReview("Looks mostly right.", "codex", "2026-06-06T10:00:00.000Z")
    ).toThrow("valid JSON");
  });

  it("extracts a structured follow-up answer", () => {
    expect(parseFollowUpAnswer('{"answer":"Compare the projection matrices."}')).toBe(
      "Compare the projection matrices."
    );
  });
});

describe("Agent bridges", () => {
  it("uses the Codex app-server JSON-RPC protocol and supports cancellation", async () => {
    const bridge = new CodexBridge({
      mcpUrl: "http://127.0.0.1:37891/mcp",
      token: "agent-token",
      workingDirectory: process.cwd(),
      appServerCommand: {
        command: process.execPath,
        args: [path.join(import.meta.dirname, "fake-codex-app-server.mjs")]
      }
    });
    try {
      const review = await bridge.review(
        "ann-json-rpc",
        new AbortController().signal
      );
      expect(review.summary).toBe("Fake structured review.");

      const controller = new AbortController();
      const cancelled = bridge.review("ann-cancel", controller.signal);
      setTimeout(() => controller.abort(), 10);
      await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      await bridge.close();
    }
  });

  it("uses the OpenCode SDK runtime with only the Annotation Tutor MCP connection", async () => {
    let receivedConfig: unknown;
    let receivedSignal: AbortSignal | undefined;
    const bridge = new OpenCodeBridge({
      mcpUrl: "http://127.0.0.1:37891/mcp",
      token: "agent-token",
      workingDirectory: "D:/isolated",
      runtimeFactory: async (options) => {
        receivedConfig = options;
        return {
          prompt: async (_prompt, signal) => {
            receivedSignal = signal;
            return JSON.stringify(validReview);
          },
          close: () => undefined
        };
      }
    });

    const controller = new AbortController();
    const review = await bridge.review("ann-1", controller.signal);

    expect(review.provider).toBe("opencode");
    expect(JSON.stringify(receivedConfig)).toContain("agent-token");
    expect(JSON.stringify(receivedConfig)).not.toContain("D:/PrivTutor/Tutor");
    expect(receivedConfig).toMatchObject({
      config: {
        tools: {
          annotation_tutor_write_agent_review: false,
          annotation_tutor_create_memory_cell: false
        }
      }
    });
    expect(receivedSignal).toBe(controller.signal);
  });

  it("passes a read-only thread and output schema to Codex", async () => {
    let capturedOptions: unknown;
    let capturedSchema: unknown;
    const bridge = new CodexBridge({
      mcpUrl: "http://127.0.0.1:37891/mcp",
      token: "agent-token",
      workingDirectory: "D:/isolated",
      runtimeFactory: (options) => {
        capturedOptions = options;
        return {
          run: async (_prompt, schema) => {
            capturedSchema = schema;
            return JSON.stringify(validReview);
          }
        };
      }
    });

    const review = await bridge.review("ann-1", new AbortController().signal);

    expect(review.provider).toBe("codex");
    expect(capturedOptions).toMatchObject({ sandboxMode: "read-only" });
    expect(capturedSchema).toHaveProperty("required");
  });

  it("parses the Codex structured follow-up envelope", async () => {
    const bridge = new CodexBridge({
      mcpUrl: "http://127.0.0.1:37891/mcp",
      token: "agent-token",
      workingDirectory: "D:/isolated",
      runtimeFactory: () => ({
        run: async () => '{"answer":"Revisit how each head projects Q, K, and V."}'
      })
    });

    await expect(
      bridge.followUp(
        "ann-1",
        "What should I review?",
        new AbortController().signal
      )
    ).resolves.toBe("Revisit how each head projects Q, K, and V.");
  });
});

describe("AgentBridgeRegistry", () => {
  it("never silently falls back to a different provider", async () => {
    const registry = new AgentBridgeRegistry();

    await expect(
      registry.review("opencode", "ann-1", new AbortController().signal)
    ).rejects.toThrow("OpenCode");
  });

  it("maps provider failures and timeouts to actionable domain errors", async () => {
    const failed = new AgentBridgeRegistry();
    failed.register({
      provider: "codex",
      review: async () => {
        throw new Error("login required");
      },
      followUp: async () => {
        throw new Error("login required");
      },
      close: async () => undefined
    });
    await expect(
      failed.review("codex", "ann-1", new AbortController().signal)
    ).rejects.toMatchObject({
      code: "AGENT_FAILED",
      message: "Codex failed: login required"
    });

    const timedOut = new AgentBridgeRegistry(5);
    timedOut.register({
      provider: "opencode",
      review: (_id, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true
          })
        ),
      followUp: async () => "",
      close: async () => undefined
    });
    await expect(
      timedOut.review("opencode", "ann-1", new AbortController().signal)
    ).rejects.toMatchObject({ code: "AGENT_TIMEOUT" });
  });
});

describe("buildReviewPrompt", () => {
  it("requires evidence labels and annotation-scoped MCP tools", () => {
    const prompt = buildReviewPrompt("ann-1");

    expect(prompt).toContain("ann-1");
    expect(prompt).toContain("Document evidence");
    expect(prompt).toContain("get_document_profile");
    expect(prompt).toContain('"correctness"');
  });
});
