import { createOpencode, type Config } from "@opencode-ai/sdk";
import type { AgentReview } from "@annotation-tutor/domain";
import { buildReviewPrompt, parseAgentReview } from "./shared.js";
import type { AgentBridge, BridgeOptions } from "./types.js";

type OpenCodeRuntimeOptions = {
  config: Config;
  workingDirectory: string;
};

type OpenCodeRuntime = {
  prompt: (prompt: string, signal: AbortSignal) => Promise<string>;
  close: () => void;
};

type OpenCodeBridgeOptions = BridgeOptions & {
  runtimeFactory?: (options: OpenCodeRuntimeOptions) => Promise<OpenCodeRuntime>;
};

export class OpenCodeBridge implements AgentBridge {
  public readonly provider = "opencode" as const;
  private readonly runtimeFactory: (
    options: OpenCodeRuntimeOptions
  ) => Promise<OpenCodeRuntime>;
  private runtime: OpenCodeRuntime | null = null;

  public constructor(private readonly options: OpenCodeBridgeOptions) {
    this.runtimeFactory = options.runtimeFactory ?? createRuntime;
  }

  public async review(annotationId: string, signal: AbortSignal): Promise<AgentReview> {
    const runtime = await this.getRuntime();
    return parseAgentReview(
      await runtime.prompt(buildReviewPrompt(annotationId), signal),
      "opencode"
    );
  }

  public async followUp(
    annotationId: string,
    question: string,
    signal: AbortSignal
  ): Promise<string> {
    const runtime = await this.getRuntime();
    return runtime.prompt(
      `Using Annotation Tutor MCP, answer one follow-up for annotation ${annotationId}. ` +
        `Separate source evidence from background knowledge. Question: ${question}`,
      signal
    );
  }

  public async close(): Promise<void> {
    this.runtime?.close();
    this.runtime = null;
  }

  private async getRuntime(): Promise<OpenCodeRuntime> {
    if (!this.runtime) {
      this.runtime = await this.runtimeFactory({
        workingDirectory: this.options.workingDirectory,
        config: {
          mcp: {
            annotation_tutor: {
              type: "remote",
              url: this.options.mcpUrl,
              headers: { Authorization: `Bearer ${this.options.token}` },
              oauth: false,
              enabled: true
            }
          },
          permission: {
            edit: "deny",
            bash: "deny",
            external_directory: "deny"
          },
          tools: {
            annotation_tutor_write_agent_review: false,
            annotation_tutor_create_memory_cell: false
          }
        }
      });
    }
    return this.runtime;
  }
}

async function createRuntime(options: OpenCodeRuntimeOptions): Promise<OpenCodeRuntime> {
  const instance = await createOpencode({
    hostname: "127.0.0.1",
    port: 0,
    config: options.config
  });
  return {
    prompt: async (prompt, signal) => {
      const session = await instance.client.session.create({
        query: { directory: options.workingDirectory },
        body: { title: "Annotation Tutor review" },
        signal,
        throwOnError: true
      });
      try {
        const response = await instance.client.session.prompt({
          path: { id: session.data.id },
          query: { directory: options.workingDirectory },
          body: {
            system:
              "You are a learning tutor. Use only Annotation Tutor MCP for learner data. Return structured JSON for reviews.",
            tools: {
              edit: false,
              bash: false,
              write: false,
              annotation_tutor_write_agent_review: false,
              annotation_tutor_create_memory_cell: false
            },
            parts: [{ type: "text", text: prompt }]
          },
          signal,
          throwOnError: true
        });
        return response.data.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
      } catch (error) {
        if (signal.aborted) {
          await instance.client.session
            .abort({
              path: { id: session.data.id },
              query: { directory: options.workingDirectory }
            })
            .catch(() => undefined);
        }
        throw error;
      }
    },
    close: instance.server.close
  };
}
