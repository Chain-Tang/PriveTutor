import { AnnotationTutorError, type AgentReview } from "@annotation-tutor/domain";
import type { AgentBridge } from "./types.js";

export class AgentBridgeRegistry {
  private readonly bridges = new Map<AgentBridge["provider"], AgentBridge>();

  public constructor(private readonly timeoutMs = 10 * 60_000) {}

  public register(bridge: AgentBridge): void {
    this.bridges.set(bridge.provider, bridge);
  }

  public async review(
    provider: AgentBridge["provider"],
    annotationId: string,
    signal: AbortSignal
  ): Promise<AgentReview> {
    const bridge = this.bridges.get(provider);
    if (!bridge) {
      throw new AnnotationTutorError(
        "AGENT_UNAVAILABLE",
        `${provider === "opencode" ? "OpenCode" : "Codex"} is not configured`,
        503
      );
    }
    return this.execute(
      provider,
      signal,
      (combinedSignal) => bridge.review(annotationId, combinedSignal)
    );
  }

  public async followUp(
    provider: AgentBridge["provider"],
    annotationId: string,
    question: string,
    signal: AbortSignal
  ): Promise<string> {
    const bridge = this.bridges.get(provider);
    if (!bridge) {
      throw new AnnotationTutorError(
        "AGENT_UNAVAILABLE",
        `${provider === "opencode" ? "OpenCode" : "Codex"} is not configured`,
        503
      );
    }
    return this.execute(
      provider,
      signal,
      (combinedSignal) =>
        bridge.followUp(annotationId, question, combinedSignal)
    );
  }

  public async close(): Promise<void> {
    await Promise.all([...this.bridges.values()].map((bridge) => bridge.close()));
  }

  private async execute<T>(
    provider: AgentBridge["provider"],
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    try {
      return await operation(AbortSignal.any([signal, timeout]));
    } catch (error) {
      if (error instanceof AnnotationTutorError) throw error;
      const displayName = provider === "opencode" ? "OpenCode" : "Codex";
      if (timeout.aborted && !signal.aborted) {
        throw new AnnotationTutorError(
          "AGENT_TIMEOUT",
          `${displayName} timed out after ${Math.round(this.timeoutMs / 1000)} seconds`,
          504
        );
      }
      if (signal.aborted) throw error;
      throw new AnnotationTutorError(
        "AGENT_FAILED",
        `${displayName} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        502
      );
    }
  }
}
