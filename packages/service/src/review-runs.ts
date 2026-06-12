import { EventEmitter } from "node:events";
import {
  AnnotationTutorError,
  agentReviewSchema,
  agentRunSchema,
  type AgentReview,
  type AgentRun
} from "@annotation-tutor/domain";

export type ReviewRunRequest = {
  annotationId: string;
  provider: "opencode" | "codex";
};

export type ReviewRunEvent =
  | { type: "status"; status: AgentRun["status"] }
  | { type: "progress"; message: string }
  | { type: "review"; review: AgentReview }
  | { type: "error"; message: string };

export type ReviewExecutor = (
  request: ReviewRunRequest,
  emit: (event: ReviewRunEvent) => void,
  signal: AbortSignal
) => Promise<AgentReview>;

type ManagedRun = {
  run: AgentRun;
  events: ReviewRunEvent[];
  controller: AbortController;
  completion: Promise<void>;
};

export class ReviewRunManager {
  private readonly runs = new Map<string, ManagedRun>();
  private readonly emitter = new EventEmitter();
  private readonly reviewConsumers: Array<
    (request: ReviewRunRequest, review: AgentReview) => Promise<void>
  > = [];

  public constructor(private readonly execute: ReviewExecutor) {}

  public start(request: ReviewRunRequest): AgentRun {
    const timestamp = new Date().toISOString();
    const run = agentRunSchema.parse({
      id: `run-${crypto.randomUUID()}`,
      annotationId: request.annotationId,
      provider: request.provider,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const controller = new AbortController();
    const managed: ManagedRun = {
      run,
      events: [{ type: "status", status: "queued" }],
      controller,
      completion: Promise.resolve()
    };
    managed.completion = this.perform(managed, request);
    this.runs.set(run.id, managed);
    return run;
  }

  public onReview(
    consumer: (request: ReviewRunRequest, review: AgentReview) => Promise<void>
  ): void {
    this.reviewConsumers.push(consumer);
  }

  public get(id: string): AgentRun {
    return this.getManaged(id).run;
  }

  public events(id: string): ReviewRunEvent[] {
    return [...this.getManaged(id).events];
  }

  public subscribe(id: string, listener: (event: ReviewRunEvent) => void): () => void {
    this.getManaged(id);
    const eventName = `run:${id}`;
    this.emitter.on(eventName, listener);
    return () => this.emitter.off(eventName, listener);
  }

  public cancel(id: string): AgentRun {
    const managed = this.getManaged(id);
    if (["completed", "cancelled", "failed"].includes(managed.run.status)) {
      return managed.run;
    }
    managed.controller.abort();
    this.update(managed, { type: "status", status: "cancelled" });
    return managed.run;
  }

  public async wait(id: string): Promise<void> {
    await this.getManaged(id).completion;
  }

  private async perform(managed: ManagedRun, request: ReviewRunRequest): Promise<void> {
    await Promise.resolve();
    if (managed.controller.signal.aborted) return;
    this.update(managed, { type: "status", status: "running" });
    try {
      const review = agentReviewSchema.parse(
        await this.execute(
          request,
          (event) => this.update(managed, event),
          managed.controller.signal
        )
      );
      if (managed.controller.signal.aborted) return;
      for (const consumer of this.reviewConsumers) {
        await consumer(request, review);
        if (managed.controller.signal.aborted) return;
      }
      this.update(managed, { type: "review", review });
      this.update(managed, { type: "status", status: "completed" });
    } catch (error) {
      if (managed.controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Unknown Agent error";
      managed.run = agentRunSchema.parse({
        ...managed.run,
        status: "failed",
        error: message,
        updatedAt: new Date().toISOString()
      });
      this.update(managed, { type: "error", message });
    }
  }

  private update(managed: ManagedRun, event: ReviewRunEvent): void {
    managed.events.push(event);
    if (event.type === "status") {
      managed.run = agentRunSchema.parse({
        ...managed.run,
        status: event.status,
        updatedAt: new Date().toISOString()
      });
    }
    this.emitter.emit(`run:${managed.run.id}`, event);
  }

  private getManaged(id: string): ManagedRun {
    const run = this.runs.get(id);
    if (!run) {
      throw new AnnotationTutorError("NOT_FOUND", `Review run not found: ${id}`, 404);
    }
    return run;
  }
}
