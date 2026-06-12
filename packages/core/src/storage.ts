import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  AnnotationTutorError,
  annotationSchema,
  memoryCellSchema,
  type Annotation,
  type MemoryCell,
  type RecentLearningContext
} from "@annotation-tutor/domain";
import { VaultPaths } from "./paths.js";

async function atomicJsonWrite(filePath: string, value: unknown): Promise<void> {
  await atomicTextWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export class AnnotationStore {
  public constructor(private readonly paths: VaultPaths) {}

  public async save(annotation: Annotation): Promise<Annotation> {
    const validated = annotationSchema.parse(annotation);
    await atomicJsonWrite(this.filePath(validated.id), validated);
    return validated;
  }

  public async get(id: string): Promise<Annotation> {
    try {
      const value = JSON.parse(await readFile(this.filePath(id), "utf8")) as unknown;
      return annotationSchema.parse(value);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw new AnnotationTutorError("NOT_FOUND", `Annotation not found: ${id}`, 404);
      }
      throw error;
    }
  }

  public async list(): Promise<Annotation[]> {
    await mkdir(this.paths.annotations, { recursive: true });
    const files = (await readdir(this.paths.annotations))
      .filter((name) => name.endsWith(".json"))
      .sort();
    return Promise.all(
      files.map(async (name) => {
        const value = JSON.parse(
          await readFile(path.join(this.paths.annotations, name), "utf8")
        ) as unknown;
        return annotationSchema.parse(value);
      })
    );
  }

  public async delete(id: string): Promise<void> {
    await rm(this.filePath(id), { force: true });
  }

  private filePath(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new AnnotationTutorError("INVALID_INPUT", "Invalid annotation ID", 400);
    }
    return path.join(this.paths.annotations, `${id}.json`);
  }
}

export class MemoryCellStore {
  public constructor(private readonly paths: VaultPaths) {}

  public async save(cell: MemoryCell): Promise<MemoryCell> {
    const validated = memoryCellSchema.parse(cell);
    await mkdir(this.paths.memoryCells, { recursive: true });
    const title = validated.concept?.name ?? validated.type.replaceAll("_", " ");
    const markdown = `---\n${stringifyYaml(validated).trimEnd()}\n---\n\n# ${title}\n\n${validated.summary}\n`;
    await atomicTextWrite(
      path.join(this.paths.memoryCells, `${validated.id}.md`),
      markdown
    );
    return validated;
  }

  public async list(): Promise<MemoryCell[]> {
    await mkdir(this.paths.memoryCells, { recursive: true });
    const files = (await readdir(this.paths.memoryCells))
      .filter((name) => name.endsWith(".md"))
      .sort();
    return Promise.all(
      files.map(async (name) => {
        const markdown = await readFile(path.join(this.paths.memoryCells, name), "utf8");
        const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
        if (!frontmatter) {
          throw new AnnotationTutorError(
            "INVALID_INPUT",
            `Memory cell has no YAML frontmatter: ${name}`,
            422
          );
        }
        return memoryCellSchema.parse(parseYaml(frontmatter));
      })
    );
  }

  public async get(id: string): Promise<MemoryCell> {
    try {
      const markdown = await readFile(this.filePath(id), "utf8");
      const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
      if (!frontmatter) {
        throw new AnnotationTutorError(
          "INVALID_INPUT",
          `Memory cell has no YAML frontmatter: ${id}`,
          422
        );
      }
      return memoryCellSchema.parse(parseYaml(frontmatter));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw new AnnotationTutorError(
          "NOT_FOUND",
          `Memory cell not found: ${id}`,
          404
        );
      }
      throw error;
    }
  }

  public async delete(id: string): Promise<void> {
    await rm(this.filePath(id), { force: true });
  }

  private filePath(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new AnnotationTutorError("INVALID_INPUT", "Invalid memory cell ID", 400);
    }
    return path.join(this.paths.memoryCells, `${id}.md`);
  }
}

export class LearningContextStore {
  public constructor(private readonly paths: VaultPaths) {}

  public async save(context: RecentLearningContext): Promise<void> {
    const sections = [
      "# Recent Learning Context",
      "",
      "## Recently Studied",
      "",
      ...bullets(context.recentlyStudied),
      "",
      "## Active Confusions",
      "",
      ...bullets(context.activeConfusions),
      "",
      "## High-value Annotations",
      "",
      ...bullets(context.highValueAnnotations),
      "",
      "## Suggested Agent Behavior",
      "",
      ...bullets(context.suggestedAgentBehavior),
      "",
      `Updated: ${context.updatedAt}`,
      ""
    ].join("\n");
    await atomicTextWrite(this.paths.learningContext, sections);
  }
}

async function atomicTextWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") {
        throw error;
      }
      await rm(filePath, { force: true });
      await rename(temporaryPath, filePath);
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function bullets(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ["- None"];
}
