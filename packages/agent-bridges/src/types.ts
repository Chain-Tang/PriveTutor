import type { AgentReview } from "@annotation-tutor/domain";

export interface AgentBridge {
  readonly provider: "opencode" | "codex";
  review(annotationId: string, signal: AbortSignal): Promise<AgentReview>;
  followUp(
    annotationId: string,
    question: string,
    signal: AbortSignal
  ): Promise<string>;
  close(): Promise<void>;
}

export type BridgeOptions = {
  mcpUrl: string;
  token: string;
  workingDirectory: string;
};

