import path from "node:path";
import { AnnotationTutorError } from "@annotation-tutor/domain";

export class VaultPaths {
  public readonly root: string;
  public readonly pluginData: string;
  public readonly annotations: string;
  public readonly index: string;
  public readonly state: string;
  public readonly logs: string;
  public readonly memoryCells: string;
  public readonly learningContext: string;

  public constructor(vaultRoot: string) {
    this.root = path.resolve(vaultRoot);
    this.pluginData = path.join(
      this.root,
      ".obsidian",
      "plugins",
      "annotation-tutor",
      "data"
    );
    this.annotations = path.join(this.pluginData, "annotations");
    this.index = path.join(this.pluginData, "index.sqlite");
    this.state = path.join(this.pluginData, "state");
    this.logs = path.join(this.pluginData, "logs");
    this.memoryCells = path.join(this.root, "Learning Memory", "memory-cells");
    this.learningContext = path.join(
      this.root,
      "Agent Context",
      "recent-learning.md"
    );
  }

  public sourceFile(vaultRelativePath: string): string {
    const normalized = vaultRelativePath.replaceAll("\\", "/");
    const candidate = path.resolve(this.root, normalized);
    if (candidate !== this.root && !candidate.startsWith(`${this.root}${path.sep}`)) {
      throw new AnnotationTutorError(
        "FORBIDDEN",
        `Resolved path is outside the Vault: ${vaultRelativePath}`,
        403
      );
    }
    return candidate;
  }
}

