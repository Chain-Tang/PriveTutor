import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VaultPaths } from "@annotation-tutor/core";
import { loadOrCreateTokens } from "@annotation-tutor/service";
import { doctorVault, setupAgent } from "./commands.js";

describe("doctorVault", () => {
  it("reports actionable Vault and plugin checks", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-doctor-"));
    await mkdir(path.join(vault, ".obsidian"), { recursive: true });

    const checks = await doctorVault(vault);

    expect(checks.find((check) => check.id === "vault")?.ok).toBe(true);
    expect(checks.find((check) => check.id === "plugin")?.ok).toBe(false);
    expect(checks.find((check) => check.id === "plugin")?.action).toContain(
      "Install"
    );
  }, 15_000);
});

describe("setupAgent", () => {
  it("writes OpenCode MCP configuration and the Annotation Tutor skill", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-setup-"));
    await mkdir(path.join(vault, ".obsidian"), { recursive: true });
    const paths = new VaultPaths(vault);
    const tokens = await loadOrCreateTokens(paths);

    await setupAgent("opencode", vault, {
      port: 37_891,
      agentToken: tokens.agentReadOnly
    });

    const config = JSON.parse(await readFile(path.join(vault, "opencode.json"), "utf8"));
    const skill = await readFile(
      path.join(vault, ".opencode", "skills", "annotation-tutor", "SKILL.md"),
      "utf8"
    );
    expect(config.mcp.annotation_tutor.url).toBe("http://127.0.0.1:37891/mcp");
    expect(config.mcp.annotation_tutor.headers.Authorization).toContain(
      tokens.agentReadOnly
    );
    expect(skill).toContain("get_recent_learning_context");
  });

  it("preserves existing Codex config while replacing its managed block", async () => {
    const vault = await mkdtemp(path.join(tmpdir(), "annotation-tutor-codex-"));
    const configDirectory = path.join(vault, ".codex");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(
      path.join(configDirectory, "config.toml"),
      'model = "custom"\n',
      "utf8"
    );

    await setupAgent("codex", vault, {
      port: 37_892,
      agentToken: "agent-token"
    });

    const config = await readFile(path.join(configDirectory, "config.toml"), "utf8");
    expect(config).toContain('model = "custom"');
    expect(config).toContain('url = "http://127.0.0.1:37892/mcp"');
  });
});
