import { spawn } from "node:child_process";
import { access, mkdir, open } from "node:fs/promises";
import path from "node:path";
import {
  AnnotationIndexer,
  AnnotationStore,
  DocumentContextService,
  HostLease,
  MemoryCellStore,
  VaultPaths
} from "@annotation-tutor/core";
import { AnnotationTutorError } from "@annotation-tutor/domain";
import { writeAgentConfiguration } from "@annotation-tutor/mcp";
import {
  loadOrCreateTokens,
  loadRuntimeState,
  startHostedRuntime
} from "@annotation-tutor/service";

export type DoctorCheck = {
  id: string;
  ok: boolean;
  message: string;
  action?: string;
};

type SetupOptions = {
  port: number;
  agentToken: string;
};

export async function doctorVault(vaultRoot: string): Promise<DoctorCheck[]> {
  const paths = new VaultPaths(vaultRoot);
  const vaultExists = await exists(path.join(paths.root, ".obsidian"));
  const pluginExists = await exists(
    path.join(paths.root, ".obsidian", "plugins", "annotation-tutor", "manifest.json")
  );
  const state = await loadRuntimeState(paths);
  const serviceRunning =
    state !== null &&
    isProcessRunning(state.pid) &&
    (await hasExpectedHealth(state.port));
  const opencodeInstalled = await commandExists("opencode");
  const codexInstalled = await commandExists("codex");
  const [opencodeAuth, codexAuth] = await Promise.all([
    opencodeInstalled ? commandOutput("opencode", ["auth", "list"]) : null,
    codexInstalled ? commandOutput("codex", ["login", "status"]) : null
  ]);
  const opencodeAuthenticated =
    opencodeAuth?.ok === true &&
    !/\b0 credentials\b/i.test(stripAnsi(opencodeAuth.output));
  const codexAuthenticated =
    codexAuth?.ok === true && /\blogged in\b/i.test(stripAnsi(codexAuth.output));
  const checks: DoctorCheck[] = [
    {
      id: "vault",
      ok: vaultExists,
      message: vaultExists ? "Obsidian Vault found" : "No .obsidian directory found",
      action: vaultExists ? undefined : "Pass --vault with an Obsidian Vault path"
    },
    {
      id: "plugin",
      ok: pluginExists,
      message: pluginExists ? "Annotation Tutor plugin installed" : "Plugin not installed",
      action: pluginExists
        ? undefined
        : "Install the Annotation Tutor plugin in this Vault"
    },
    {
      id: "service",
      ok: serviceRunning,
      message:
        serviceRunning
          ? `Local service is running on port ${state.port}`
          : "Local service is not running",
      action:
        serviceRunning
          ? undefined
          : "Open Obsidian or run annotation-tutor start"
    },
    {
      id: "opencode",
      ok: opencodeInstalled && opencodeAuthenticated,
      message: !opencodeInstalled
        ? "OpenCode not found"
        : opencodeAuthenticated
          ? "OpenCode found and authenticated"
          : "OpenCode found but no stored credentials were detected",
      action:
        opencodeInstalled && !opencodeAuthenticated
          ? "Run opencode auth login"
          : "Install and authenticate OpenCode to use this provider"
    },
    {
      id: "codex",
      ok: codexInstalled && codexAuthenticated,
      message: !codexInstalled
        ? "Codex not found"
        : codexAuthenticated
          ? "Codex found and authenticated"
          : "Codex found but is not authenticated",
      action:
        codexInstalled && !codexAuthenticated
          ? "Run codex login"
          : "Install and authenticate Codex to use this provider"
    }
  ];
  return checks;
}

export async function setupAgent(
  provider: "opencode" | "codex",
  vaultRoot: string,
  options?: SetupOptions
): Promise<void> {
  const paths = new VaultPaths(vaultRoot);
  const state = await loadRuntimeState(paths);
  const tokens = options
    ? { agentReadOnly: options.agentToken }
    : await loadOrCreateTokens(paths);
  const port = options?.port ?? state?.port ?? 37_891;
  const url = `http://127.0.0.1:${port}/mcp`;
  await writeAgentConfiguration(provider, paths.root, url, tokens.agentReadOnly);
}

export async function rebuildIndex(vaultRoot: string): Promise<number> {
  const paths = new VaultPaths(vaultRoot);
  const lease = new HostLease(paths, "cli");
  await lease.acquire();
  const store = new AnnotationStore(paths);
  let indexer: AnnotationIndexer | undefined;
  try {
    indexer = new AnnotationIndexer(paths);
    const annotations = await store.list();
    await indexer.rebuild(
      annotations,
      await new MemoryCellStore(paths).list()
    );
    const documents = new DocumentContextService(paths, store, {}, indexer);
    const indexedFiles = new Set<string>();
    for (const annotation of annotations) {
      if (indexedFiles.has(annotation.filePath)) continue;
      indexedFiles.add(annotation.filePath);
      try {
        await documents.listChunks(annotation.id);
      } catch (error) {
        if (!(error instanceof AnnotationTutorError) || error.code !== "NOT_FOUND") {
          throw error;
        }
      }
    }
    return annotations.length;
  } finally {
    indexer?.close();
    await lease.release();
  }
}

export async function exportAnnotations(vaultRoot: string): Promise<string> {
  const paths = new VaultPaths(vaultRoot);
  const annotations = await new AnnotationStore(paths).list();
  return [
    "# Annotation Tutor Export",
    "",
    ...annotations.flatMap((annotation) => [
      `## ${annotation.id}`,
      "",
      `- Source: \`${annotation.filePath}\``,
      `- Status: ${annotation.status}`,
      "",
      `> ${annotation.anchor.selectedText}`,
      "",
      annotation.userNote.content,
      annotation.review ? `\n**Review:** ${annotation.review.summary}` : "",
      ""
    ])
  ].join("\n");
}

export async function startBackground(vaultRoot: string): Promise<number> {
  const paths = new VaultPaths(vaultRoot);
  const state = await loadRuntimeState(paths);
  if (state && isProcessRunning(state.pid)) {
    if (state.owner === "cli") {
      throw new Error(`Annotation Tutor CLI service is already running (PID ${state.pid})`);
    }
    const tokens = await loadOrCreateTokens(paths);
    const response = await fetch(`http://127.0.0.1:${state.port}/api/host/release`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.admin}` }
    });
    if (!response.ok) {
      throw new Error(`Plugin service refused takeover: ${response.status}`);
    }
    await waitForHostRelease(paths, 5_000);
  }
  const entry = process.argv[1];
  if (!entry) throw new Error("Cannot determine the CLI entry point");
  await mkdir(paths.logs, { recursive: true });
  const log = await open(path.join(paths.logs, "service.log"), "a");
  const child = spawn(process.execPath, [entry, "serve", "--vault", vaultRoot], {
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    windowsHide: true
  });
  child.unref();
  await log.close();
  const pid = child.pid ?? 0;
  await waitForCliStartup(paths, pid, 10_000);
  return pid;
}

async function waitForHostRelease(
  paths: VaultPaths,
  timeoutMs: number
): Promise<void> {
  const lease = new HostLease(paths, "cli");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await lease.current())) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the plugin service to release the Vault");
}

async function waitForCliStartup(
  paths: VaultPaths,
  pid: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      throw new Error(`CLI service exited during startup; inspect ${paths.logs}`);
    }
    const state = await loadRuntimeState(paths);
    if (state?.owner === "cli" && state.pid === pid) {
      try {
        const response = await fetch(`http://127.0.0.1:${state.port}/api/health`);
        if (response.ok) return;
      } catch {
        // The listener may not be ready yet.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out starting the CLI service; inspect ${paths.logs}`);
}

export async function serveForeground(vaultRoot: string): Promise<void> {
  const runtime = await startHostedRuntime({ vaultRoot, owner: "cli" });
  const close = async () => {
    await runtime.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  await new Promise(() => undefined);
}

export async function stopService(vaultRoot: string): Promise<boolean> {
  const paths = new VaultPaths(vaultRoot);
  const state = await loadRuntimeState(paths);
  if (!state || !isProcessRunning(state.pid)) return false;
  if (state.owner !== "cli") {
    throw new Error("The Obsidian plugin owns the service; close it from Obsidian");
  }
  const lease = await new HostLease(paths, "cli").current();
  if (
    lease?.owner !== "cli" ||
    lease.pid !== state.pid ||
    !(await hasExpectedHealth(state.port))
  ) {
    throw new Error(
      "The recorded CLI process does not match a healthy Annotation Tutor service; refusing to terminate it"
    );
  }
  process.kill(state.pid, "SIGTERM");
  return true;
}

export async function status(vaultRoot: string): Promise<{
  running: boolean;
  port?: number;
  owner?: string;
}> {
  const state = await loadRuntimeState(new VaultPaths(vaultRoot));
  if (
    !state ||
    !isProcessRunning(state.pid) ||
    !(await hasExpectedHealth(state.port))
  ) {
    return { running: false };
  }
  return { running: true, port: state.port, owner: state.owner };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command: string): Promise<boolean> {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const names =
      process.platform === "win32"
        ? [`${command}.exe`, `${command}.cmd`, `${command}.ps1`, command]
        : [command];
    for (const name of names) {
      if (directory && (await exists(path.join(directory, name)))) return true;
    }
  }
  return false;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function commandOutput(
  command: string,
  args: string[]
): Promise<{ ok: boolean; output: string }> {
  const executable =
    process.platform === "win32"
      ? (process.env.ComSpec ?? "cmd.exe")
      : command;
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", [command, ...args].join(" ")]
      : args;
  return new Promise((resolve) => {
    const child = spawn(executable, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let settled = false;
    let output = "";
    const finish = (result: { ok: boolean; output: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, output: `${output}\nCommand timed out` });
    }, 5_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", () => finish({ ok: false, output }));
    child.once("exit", (code) => finish({ ok: code === 0, output }));
  });
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

async function hasExpectedHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(2_000)
    });
    if (!response.ok) return false;
    const health = (await response.json()) as { ok?: unknown; version?: unknown };
    return health.ok === true && health.version === "0.1.0";
  } catch {
    return false;
  }
}
