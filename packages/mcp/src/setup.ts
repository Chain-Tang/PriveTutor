import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { annotationTutorAgentInstructions } from "./templates.js";

export async function writeAgentConfiguration(
  provider: "opencode" | "codex",
  vaultRoot: string,
  mcpUrl: string,
  agentToken: string
): Promise<void> {
  if (provider === "opencode") {
    await setupOpenCode(vaultRoot, mcpUrl, agentToken);
  } else {
    await setupCodex(vaultRoot, mcpUrl, agentToken);
  }
}

async function setupOpenCode(
  vaultRoot: string,
  url: string,
  token: string
): Promise<void> {
  const configPath = path.join(vaultRoot, "opencode.json");
  let config: Record<string, unknown> = {};
  if (await exists(configPath)) {
    config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  }
  const mcp =
    typeof config.mcp === "object" && config.mcp !== null
      ? (config.mcp as Record<string, unknown>)
      : {};
  mcp.annotation_tutor = {
    type: "remote",
    url,
    headers: { Authorization: `Bearer ${token}` },
    oauth: false,
    enabled: true
  };
  config.mcp = mcp;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const skillPath = path.join(
    vaultRoot,
    ".opencode",
    "skills",
    "annotation-tutor",
    "SKILL.md"
  );
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(skillPath, annotationTutorAgentInstructions, "utf8");
}

async function setupCodex(
  vaultRoot: string,
  url: string,
  token: string
): Promise<void> {
  const configPath = path.join(vaultRoot, ".codex", "config.toml");
  await mkdir(path.dirname(configPath), { recursive: true });
  const current = (await exists(configPath)) ? await readFile(configPath, "utf8") : "";
  const start = "# >>> annotation-tutor >>>";
  const end = "# <<< annotation-tutor <<<";
  const withoutManaged = current.replace(
    new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\s*`, "g"),
    ""
  );
  const managed = `${start}
[mcp_servers.annotation_tutor]
url = "${url}"
http_headers = { Authorization = "Bearer ${token}" }
enabled_tools = ["list_recent_annotations", "search_annotations", "get_annotation_detail", "get_recent_learning_context", "get_document_profile", "get_document_outline", "read_document_chunk", "search_document"]
${end}
`;
  await writeFile(configPath, `${withoutManaged.trimEnd()}\n\n${managed}`, "utf8");

  const agentsPath = path.join(vaultRoot, "AGENTS.md");
  const existing = (await exists(agentsPath)) ? await readFile(agentsPath, "utf8") : "";
  if (!existing.includes("## Annotation Tutor")) {
    await appendFile(
      agentsPath,
      `${existing ? "\n" : ""}## Annotation Tutor\n\n${annotationTutorAgentInstructions}\n`,
      "utf8"
    );
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

