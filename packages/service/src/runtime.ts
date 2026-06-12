import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  AnnotationIndexer,
  AnnotationStore,
  AnnotationTutorService,
  DocumentContextService,
  HostLease,
  LearningContextStore,
  MemoryCellStore,
  PermissionService,
  VaultPaths,
  type HostOwner
} from "@annotation-tutor/core";
import {
  permissionPolicySchema,
  type PermissionPolicy
} from "@annotation-tutor/domain";
import {
  AgentBridgeRegistry,
  CodexBridge,
  OpenCodeBridge
} from "@annotation-tutor/agent-bridges";
import {
  createAnnotationTutorMcpServer,
  createMcpHttpHandler
} from "@annotation-tutor/mcp";
import { createApiApp } from "./app.js";
import { ReviewRunManager } from "./review-runs.js";
import { startLocalServer, type StartedServer } from "./server.js";

export type AccessTokens = {
  admin: string;
  agentReadOnly: string;
};

export type RuntimeState = {
  owner: HostOwner;
  pid: number;
  port: number;
  startedAt: string;
};

export type HostedRuntime = {
  service: AnnotationTutorService;
  paths: VaultPaths;
  tokens: AccessTokens;
  state: RuntimeState;
  close: () => Promise<void>;
};

type StartHostedRuntimeOptions = {
  vaultRoot: string;
  owner: HostOwner;
  preferredPort?: number;
  policy?: Partial<PermissionPolicy>;
  enableOpenCode?: boolean;
  enableCodex?: boolean;
};

export async function startHostedRuntime(
  options: StartHostedRuntimeOptions
): Promise<HostedRuntime> {
  const paths = new VaultPaths(options.vaultRoot);
  const lease = new HostLease(paths, options.owner);
  await lease.acquire();

  const annotations = new AnnotationStore(paths);
  const indexer = new AnnotationIndexer(paths);
  const permissions = new PermissionService(
    options.policy ?? (await loadPolicy(paths))
  );
  const service = new AnnotationTutorService({
    annotations,
    memoryCells: new MemoryCellStore(paths),
    documents: new DocumentContextService(paths, annotations, {}, indexer),
    indexer,
    permissions,
    learningContext: new LearningContextStore(paths)
  });
  await service.initialize();

  const tokens = await loadOrCreateTokens(paths);
  const mcpHandler = createMcpHttpHandler(() =>
    createAnnotationTutorMcpServer(service)
  );
  const bridges = new AgentBridgeRegistry();
  const isolatedDirectory = path.join(paths.state, "agent-workspace");
  await mkdir(isolatedDirectory, { recursive: true });

  let server: StartedServer | null = null;
  let closing: Promise<void> | null = null;
  const closeRuntime = (): Promise<void> => {
    closing ??= (async () => {
      await server?.close();
      await bridges.close();
      indexer.close();
      await lease.release();
    })();
    return closing;
  };
  try {
    const reviewRuns = new ReviewRunManager((request, emit, signal) => {
      emit({ type: "progress", message: `Connecting to ${request.provider}` });
      return bridges.review(request.provider, request.annotationId, signal);
    });
    const app = createApiApp({
      service,
      version: "0.1.0",
      vaultName: path.basename(paths.root),
      tokens,
      reviewRuns,
      mcpHandler,
      followUp: (annotationId, provider, question, signal) =>
        bridges.followUp(provider, annotationId, question, signal),
      releaseHost:
        options.owner === "plugin"
          ? () => {
              setTimeout(() => void closeRuntime(), 25);
            }
          : undefined,
      permissionsUpdated: (policy) => savePolicy(paths, policy)
    });
    server = await startLocalServer(app, options.preferredPort);
    const mcpUrl = `http://127.0.0.1:${server.port}/mcp`;

    if (options.enableOpenCode !== false && (await commandExists("opencode"))) {
      bridges.register(
        new OpenCodeBridge({
          mcpUrl,
          token: tokens.agentReadOnly,
          workingDirectory: isolatedDirectory
        })
      );
    }
    if (options.enableCodex !== false && (await commandExists("codex"))) {
      bridges.register(
        new CodexBridge({
          mcpUrl,
          token: tokens.agentReadOnly,
          workingDirectory: isolatedDirectory
        })
      );
    }

    const state: RuntimeState = {
      owner: options.owner,
      pid: process.pid,
      port: server.port,
      startedAt: new Date().toISOString()
    };
    await writeRuntimeState(paths, state);
    return {
      service,
      paths,
      tokens,
      state,
      close: closeRuntime
    };
  } catch (error) {
    await closeRuntime();
    throw error;
  }
}

export async function loadOrCreateTokens(paths: VaultPaths): Promise<AccessTokens> {
  const tokenPath = path.join(paths.state, "access-tokens.json");
  try {
    return JSON.parse(await readFile(tokenPath, "utf8")) as AccessTokens;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const tokens = {
    admin: randomBytes(32).toString("base64url"),
    agentReadOnly: randomBytes(32).toString("base64url")
  };
  await mkdir(path.dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, `${JSON.stringify(tokens, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  if (process.platform !== "win32") {
    await chmod(tokenPath, 0o600);
  }
  return tokens;
}

export async function loadRuntimeState(paths: VaultPaths): Promise<RuntimeState | null> {
  try {
    return JSON.parse(
      await readFile(path.join(paths.state, "runtime.json"), "utf8")
    ) as RuntimeState;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

async function writeRuntimeState(
  paths: VaultPaths,
  state: RuntimeState
): Promise<void> {
  await mkdir(paths.state, { recursive: true });
  await writeFile(
    path.join(paths.state, "runtime.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

async function loadPolicy(paths: VaultPaths): Promise<PermissionPolicy> {
  try {
    return permissionPolicySchema.parse(
      JSON.parse(await readFile(path.join(paths.state, "permissions.json"), "utf8"))
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return permissionPolicySchema.parse({});
    }
    throw error;
  }
}

async function savePolicy(
  paths: VaultPaths,
  policy: PermissionPolicy
): Promise<void> {
  await mkdir(paths.state, { recursive: true });
  await writeFile(
    path.join(paths.state, "permissions.json"),
    `${JSON.stringify(policy, null, 2)}\n`,
    "utf8"
  );
}

async function commandExists(command: string): Promise<boolean> {
  const directories = (process.env.PATH ?? "").split(path.delimiter);
  for (const directory of directories) {
    if (!directory) continue;
    const names =
      process.platform === "win32"
        ? [`${command}.exe`, `${command}.cmd`, `${command}.ps1`, command]
        : [command];
    for (const name of names) {
      try {
        await access(path.join(directory, name));
        return true;
      } catch {
        // Continue through PATH.
      }
    }
  }
  return false;
}
