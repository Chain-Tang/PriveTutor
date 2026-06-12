import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { encode } from "gpt-tokenizer";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import type { Heading, Root } from "mdast";
import type {
  DocumentChunk,
  DocumentOutlineItem,
  DocumentProfile,
  DocumentSearchHit
} from "@annotation-tutor/domain";
import { AnnotationTutorError } from "@annotation-tutor/domain";
import { AnnotationStore } from "./storage.js";
import { VaultPaths } from "./paths.js";
import type { AnnotationIndexer } from "./indexer.js";

type DocumentContextOptions = {
  estimateTokens?: (text: string) => number;
  targetChunkTokens?: number;
  maximumChunkTokens?: number;
};

type LoadedDocument = {
  annotationId: string;
  filePath: string;
  content: string;
  outline: DocumentOutlineItem[];
  chunks: DocumentChunk[];
};

export class DocumentContextService {
  private readonly estimateTokens: (text: string) => number;
  private readonly targetChunkTokens: number;
  private readonly maximumChunkTokens: number;

  public constructor(
    private readonly paths: VaultPaths,
    private readonly annotations: AnnotationStore,
    options: DocumentContextOptions = {},
    private readonly indexer?: AnnotationIndexer
  ) {
    this.estimateTokens = options.estimateTokens ?? ((text) => encode(text).length);
    this.targetChunkTokens = options.targetChunkTokens ?? 10_000;
    this.maximumChunkTokens = options.maximumChunkTokens ?? 12_000;
  }

  public async getProfile(annotationId: string): Promise<DocumentProfile> {
    const document = await this.load(annotationId);
    const estimatedTokens = this.estimateTokens(document.content);
    return {
      annotationId,
      filePath: document.filePath,
      estimatedTokens,
      strategy:
        estimatedTokens <= 30_000
          ? "full"
          : estimatedTokens <= 60_000
            ? "ordered-chunks"
            : "progressive-search",
      headingCount: document.outline.length,
      chunkCount: document.chunks.length
    };
  }

  public async getOutline(annotationId: string): Promise<DocumentOutlineItem[]> {
    return (await this.load(annotationId)).outline;
  }

  public async readContent(
    annotationId: string
  ): Promise<{ annotationId: string; filePath: string; content: string }> {
    const document = await this.load(annotationId);
    return {
      annotationId,
      filePath: document.filePath,
      content: document.content
    };
  }

  public async readChunk(annotationId: string, chunkId: string): Promise<DocumentChunk> {
    const document = await this.load(annotationId);
    const chunk = document.chunks.find((candidate) => candidate.id === chunkId);
    if (!chunk) {
      throw new AnnotationTutorError("NOT_FOUND", `Document chunk not found: ${chunkId}`, 404);
    }
    return chunk;
  }

  public async listChunks(annotationId: string): Promise<DocumentChunk[]> {
    return (await this.load(annotationId)).chunks;
  }

  public async search(
    annotationId: string,
    query: string,
    limit = 10
  ): Promise<DocumentSearchHit[]> {
    const terms = query
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length > 1);
    if (terms.length === 0) return [];
    const document = await this.load(annotationId);
    if (this.indexer) {
      return this.indexer.searchDocument(document.filePath, query, limit);
    }
    return document.chunks
      .map((chunk) => {
        const normalized = chunk.content.toLocaleLowerCase();
        const matches = terms.reduce(
          (count, term) => count + (normalized.includes(term) ? 1 : 0),
          0
        );
        return {
          chunkId: chunk.id,
          headingPath: chunk.headingPath,
          excerpt: createExcerpt(chunk.content, terms),
          score: matches / terms.length
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(Math.max(limit, 1), 50));
  }

  private async load(annotationId: string): Promise<LoadedDocument> {
    const annotation = await this.annotations.get(annotationId);
    const filePath = this.paths.sourceFile(annotation.filePath);
    let content: string;
    try {
      const [realRoot, realFile] = await Promise.all([
        realpath(this.paths.root),
        realpath(filePath)
      ]);
      const relative = path.relative(realRoot, realFile);
      if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new AnnotationTutorError(
          "FORBIDDEN",
          `Source document resolves outside the Vault: ${annotation.filePath}`,
          403
        );
      }
      content = await readFile(realFile, "utf8");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw new AnnotationTutorError(
          "NOT_FOUND",
          `Source document not found: ${annotation.filePath}`,
          404
        );
      }
      throw error;
    }
    const outline = parseOutline(content);
    const chunks = createChunks(
      annotationId,
      content,
      outline,
      this.estimateTokens,
      this.targetChunkTokens,
      this.maximumChunkTokens
    );
    this.indexer?.replaceDocumentSections(annotation.filePath, chunks);
    return {
      annotationId,
      filePath: annotation.filePath,
      content,
      outline,
      chunks
    };
  }
}

function parseOutline(markdown: string): DocumentOutlineItem[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const outline: DocumentOutlineItem[] = [];
  visit(tree, "heading", (heading: Heading) => {
    const title = heading.children
      .map((child) => ("value" in child ? String(child.value) : ""))
      .join("")
      .trim();
    const line = Math.max((heading.position?.start.line ?? 1) - 1, 0);
    outline.push({
      id: `heading-${outline.length + 1}`,
      level: heading.depth,
      title,
      line
    });
  });
  return outline;
}

function createChunks(
  annotationId: string,
  markdown: string,
  outline: DocumentOutlineItem[],
  estimateTokens: (text: string) => number,
  targetTokens: number,
  maximumTokens: number
): DocumentChunk[] {
  const lines = markdown.split(/\r?\n/);
  const boundaries = outline.length > 0 ? outline.map((heading) => heading.line) : [0];
  if (boundaries[0] !== 0) boundaries.unshift(0);

  const sections = boundaries.map((startLine, index) => {
    const endLine = (boundaries[index + 1] ?? lines.length) - 1;
    return {
      startLine,
      endLine,
      content: lines.slice(startLine, endLine + 1).join("\n"),
      headingPath: headingPathAt(outline, startLine)
    };
  });

  const chunks: DocumentChunk[] = [];
  let current = {
    startLine: sections[0]?.startLine ?? 0,
    endLine: sections[0]?.endLine ?? 0,
    content: "",
    headingPath: sections[0]?.headingPath ?? []
  };

  const flush = () => {
    if (!current.content) return;
    chunks.push({
      id: `chunk-${chunks.length + 1}`,
      annotationId,
      headingPath: current.headingPath,
      startLine: current.startLine,
      endLine: current.endLine,
      estimatedTokens: estimateTokens(current.content),
      content: current.content
    });
  };

  for (const section of sections) {
    const combined = current.content
      ? `${current.content}\n${section.content}`
      : section.content;
    if (current.content && estimateTokens(combined) > targetTokens) {
      flush();
      current = { ...section };
    } else {
      current = {
        ...current,
        endLine: section.endLine,
        content: combined
      };
    }

    if (estimateTokens(current.content) > maximumTokens) {
      const split = splitLargeSection(current, annotationId, chunks.length, estimateTokens, maximumTokens);
      chunks.push(...split);
      current = {
        startLine: current.endLine + 1,
        endLine: current.endLine + 1,
        content: "",
        headingPath: current.headingPath
      };
    }
  }
  flush();
  return chunks;
}

function splitLargeSection(
  section: { startLine: number; endLine: number; content: string; headingPath: string[] },
  annotationId: string,
  offset: number,
  estimateTokens: (text: string) => number,
  maximumTokens: number
): DocumentChunk[] {
  const lines = section.content.split(/\r?\n/);
  const chunks: DocumentChunk[] = [];
  let buffer = "";
  let startLine = section.startLine;
  let endLine = section.startLine;

  const flush = () => {
    if (!buffer) return;
    chunks.push({
      id: `chunk-${offset + chunks.length + 1}`,
      annotationId,
      headingPath: section.headingPath,
      startLine,
      endLine,
      estimatedTokens: estimateTokens(buffer),
      content: buffer
    });
    buffer = "";
  };

  for (const [index, line] of lines.entries()) {
    const lineNumber = section.startLine + index;
    for (const part of splitTextToTokenLimit(line, estimateTokens, maximumTokens)) {
      const combined = buffer ? `${buffer}\n${part}` : part;
      if (buffer && estimateTokens(combined) > maximumTokens) {
        flush();
        startLine = lineNumber;
      }
      buffer = buffer ? `${buffer}\n${part}` : part;
      endLine = lineNumber;
    }
  }
  flush();
  return chunks;
}

function splitTextToTokenLimit(
  text: string,
  estimateTokens: (text: string) => number,
  maximumTokens: number
): string[] {
  if (estimateTokens(text) <= maximumTokens) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining) {
    let low = 1;
    let high = remaining.length;
    let accepted = 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (estimateTokens(remaining.slice(0, middle)) <= maximumTokens) {
        accepted = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    parts.push(remaining.slice(0, accepted));
    remaining = remaining.slice(accepted);
  }
  return parts;
}

function headingPathAt(
  outline: DocumentOutlineItem[],
  line: number
): string[] {
  const path: string[] = [];
  for (const heading of outline) {
    if (heading.line > line) break;
    path.splice(heading.level - 1);
    path[heading.level - 1] = heading.title;
  }
  return path.filter(Boolean);
}

function createExcerpt(content: string, terms: string[]): string {
  const normalized = content.toLocaleLowerCase();
  const indexes = terms
    .map((term) => normalized.indexOf(term))
    .filter((index) => index >= 0);
  const match = Math.min(...indexes);
  const start = Math.max(match - 100, 0);
  return content.slice(start, start + 400).trim();
}
