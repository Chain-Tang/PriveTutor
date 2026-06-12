import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import type { AgentReview } from "@annotation-tutor/domain";
import {
  buildReviewPrompt,
  parseAgentReview,
  parseFollowUpAnswer,
  reviewOutputJsonSchema
} from "./shared.js";
import type { AgentBridge, BridgeOptions } from "./types.js";

type CodexRuntimeOptions = {
  sandboxMode: "read-only";
  workingDirectory: string;
  mcpUrl: string;
  token: string;
  appServerCommand?: {
    command: string;
    args: string[];
  };
};

type CodexRuntime = {
  run: (prompt: string, schema: unknown, signal: AbortSignal) => Promise<string>;
  close?: () => Promise<void>;
};

type CodexBridgeOptions = BridgeOptions & {
  runtimeFactory?: (options: CodexRuntimeOptions) => CodexRuntime;
  appServerCommand?: CodexRuntimeOptions["appServerCommand"];
};

type JsonRpcResponse = {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type ServerMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type ThreadStartResult = {
  thread: { id: string };
};

type TurnStartResult = {
  turn: { id: string };
};

type TurnCompletedParams = {
  threadId: string;
  turn: {
    id: string;
    status: "completed" | "interrupted" | "failed" | "inProgress";
    error?: { message?: string } | null;
    items?: Array<{ type: string; text?: string }>;
  };
};

type ItemCompletedParams = {
  threadId: string;
  turnId: string;
  item: { type: string; text?: string };
};

export class CodexBridge implements AgentBridge {
  public readonly provider = "codex" as const;
  private readonly runtime: CodexRuntime;

  public constructor(private readonly options: CodexBridgeOptions) {
    this.runtime = (options.runtimeFactory ?? createRuntime)({
      sandboxMode: "read-only",
      workingDirectory: options.workingDirectory,
      mcpUrl: options.mcpUrl,
      token: options.token,
      appServerCommand: options.appServerCommand
    });
  }

  public async review(annotationId: string, signal: AbortSignal): Promise<AgentReview> {
    const response = await this.runtime.run(
      buildReviewPrompt(annotationId),
      reviewOutputJsonSchema,
      signal
    );
    return parseAgentReview(response, "codex");
  }

  public async followUp(
    annotationId: string,
    question: string,
    signal: AbortSignal
  ): Promise<string> {
    return parseFollowUpAnswer(
      await this.runtime.run(
        `Using Annotation Tutor MCP, answer one follow-up for annotation ${annotationId}. ` +
          `Separate source evidence from background knowledge. Question: ${question}`,
        {
          type: "object",
          additionalProperties: false,
          required: ["answer"],
          properties: { answer: { type: "string", minLength: 1 } }
        },
        signal
      )
    );
  }

  public async close(): Promise<void> {
    await this.runtime.close?.();
  }
}

function createRuntime(options: CodexRuntimeOptions): CodexRuntime {
  const server = new CodexAppServer(options);
  return {
    run: (prompt, schema, signal) => server.run(prompt, schema, signal),
    close: () => server.close()
  };
}

class CodexAppServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: readline.Interface;
  private readonly notifications = new EventEmitter();
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly ready: Promise<void>;
  private nextId = 1;
  private stderr = "";
  private closed = false;

  public constructor(private readonly options: CodexRuntimeOptions) {
    const command =
      options.appServerCommand?.command ??
      (process.platform === "win32"
        ? (process.env.ComSpec ?? "cmd.exe")
        : "codex");
    const args =
      options.appServerCommand?.args ??
      (process.platform === "win32"
        ? ["/d", "/s", "/c", "codex app-server --stdio"]
        : ["app-server", "--stdio"]);
    this.child = spawn(
      command,
      args,
      {
        cwd: options.workingDirectory,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      }
    );
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-8_000);
    });
    this.lines = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity
    });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.once("error", (error) => this.failAll(error));
    this.child.once("exit", (code, signal) => {
      if (!this.closed) {
        const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
        this.failAll(
          new Error(
            `Codex app-server exited with ${detail}${
              this.stderr ? `: ${this.stderr.trim()}` : ""
            }`
          )
        );
      }
    });
    this.ready = this.initialize();
  }

  public async run(
    prompt: string,
    outputSchema: unknown,
    signal: AbortSignal
  ): Promise<string> {
    await this.ready;
    signal.throwIfAborted();
    const thread = (await this.request("thread/start", {
      cwd: this.options.workingDirectory,
      approvalPolicy: "never",
      sandbox: this.options.sandboxMode,
      ephemeral: true,
      baseInstructions:
        "You are a learning tutor. Use only Annotation Tutor MCP for learner data. Do not use shell commands or modify files.",
      config: {
        web_search: "disabled",
        mcp_servers: {
          annotation_tutor: {
            url: this.options.mcpUrl,
            http_headers: {
              Authorization: `Bearer ${this.options.token}`
            },
            enabled_tools: [
              "list_recent_annotations",
              "search_annotations",
              "get_annotation_detail",
              "get_recent_learning_context",
              "get_document_profile",
              "get_document_outline",
              "read_document_chunk",
              "search_document"
            ]
          }
        }
      }
    })) as ThreadStartResult;
    const threadId = thread.thread.id;
    let turnId: string | null = null;
    let finalResponse = "";
    let settle: ((error?: Error) => void) | undefined;
    const completed = new Promise<void>((resolve, reject) => {
      settle = (error) => (error ? reject(error) : resolve());
    });
    const onNotification = (message: ServerMessage) => {
      if (message.method === "item/completed") {
        const params = message.params as ItemCompletedParams;
        if (
          params.threadId === threadId &&
          (!turnId || params.turnId === turnId) &&
          params.item.type === "agentMessage"
        ) {
          finalResponse = params.item.text ?? finalResponse;
        }
      }
      if (message.method === "turn/completed") {
        const params = message.params as TurnCompletedParams;
        if (
          params.threadId !== threadId ||
          (turnId && params.turn.id !== turnId)
        ) {
          return;
        }
        const messageItem = params.turn.items
          ?.filter((item) => item.type === "agentMessage")
          .at(-1);
        finalResponse = messageItem?.text ?? finalResponse;
        if (params.turn.status === "failed") {
          settle?.(
            new Error(params.turn.error?.message ?? "Codex turn failed")
          );
        } else if (params.turn.status === "interrupted") {
          settle?.(abortError());
        } else {
          settle?.();
        }
      }
      if (message.method === "error") {
        const params = message.params as {
          threadId?: string;
          turnId?: string;
          willRetry?: boolean;
          error?: { message?: string };
        };
        if (
          params.threadId === threadId &&
          (!turnId || params.turnId === turnId) &&
          !params.willRetry
        ) {
          settle?.(new Error(params.error?.message ?? "Codex app-server error"));
        }
      }
      if (message.method === "$exit") {
        settle?.(new Error("Codex app-server exited during a turn"));
      }
    };
    const onAbort = () => {
      if (turnId) {
        void this.request("turn/interrupt", { threadId, turnId }).catch(
          () => undefined
        );
      }
      settle?.(abortError());
    };
    this.notifications.on("message", onNotification);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const turn = (await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        outputSchema
      })) as TurnStartResult;
      turnId = turn.turn.id;
      if (signal.aborted) {
        await this.request("turn/interrupt", { threadId, turnId }).catch(
          () => undefined
        );
        throw abortError();
      }
      await completed;
      if (!finalResponse.trim()) {
        throw new Error("Codex app-server completed without an agent response");
      }
      return finalResponse;
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.notifications.off("message", onNotification);
    }
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.child.stdin.end();
    if (!this.child.killed) this.child.kill();
    this.failAll(new Error("Codex app-server closed"));
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "annotation-tutor", version: "0.1.0" },
      capabilities: null
    });
    this.notify("initialized");
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server is closed"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ method, id, params });
    });
  }

  private notify(method: string): void {
    this.write({ method });
  }

  private write(message: object): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(line) as ServerMessage;
    } catch {
      return;
    }
    if (typeof message.id === "number" && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      const response = message as JsonRpcResponse;
      if (response.error) {
        pending.reject(
          new Error(
            response.error.message ??
              `Codex app-server request failed (${response.error.code ?? "unknown"})`
          )
        );
      } else {
        pending.resolve(response.result);
      }
      return;
    }
    if (typeof message.id === "number" && message.method) {
      this.write({
        id: message.id,
        error: {
          code: -32601,
          message: `Annotation Tutor does not support ${message.method}`
        }
      });
      return;
    }
    this.notifications.emit("message", message);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.notifications.emit("message", { method: "$exit" });
  }
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}
