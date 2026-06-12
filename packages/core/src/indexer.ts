import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Annotation,
  AnnotationQuery,
  DocumentChunk,
  DocumentSearchHit,
  MemoryCell
} from "@annotation-tutor/domain";
import { annotationQuerySchema } from "@annotation-tutor/domain";
import { VaultPaths } from "./paths.js";

type AnnotationRow = {
  id: string;
};

export class AnnotationIndexer {
  private static readonly schemaVersion = 2;
  private readonly database: DatabaseSync;

  public constructor(paths: VaultPaths, databasePath = paths.index) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = this.openDatabase(databasePath);
  }

  public upsert(annotation: Annotation): void {
    this.database
      .prepare(`
        INSERT INTO annotations (
          id, file_path, selected_text, user_note, review_summary, status,
          correctness, tags, concepts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          file_path = excluded.file_path,
          selected_text = excluded.selected_text,
          user_note = excluded.user_note,
          review_summary = excluded.review_summary,
          status = excluded.status,
          correctness = excluded.correctness,
          tags = excluded.tags,
          concepts = excluded.concepts,
          updated_at = excluded.updated_at
      `)
      .run(
        annotation.id,
        annotation.filePath,
        annotation.anchor.selectedText,
        annotation.userNote.content,
        annotation.review?.summary ?? null,
        annotation.status,
        annotation.review?.correctness ?? null,
        JSON.stringify(annotation.tags),
        JSON.stringify(annotation.concepts),
        annotation.createdAt,
        annotation.updatedAt
      );
    this.database.prepare("DELETE FROM annotation_fts WHERE id = ?").run(annotation.id);
    this.database
      .prepare(
        "INSERT INTO annotation_fts (id, selected_text, user_note, review_summary, tags, concepts) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        annotation.id,
        annotation.anchor.selectedText,
        annotation.userNote.content,
        annotation.review?.summary ?? "",
        annotation.tags.join(" "),
        annotation.concepts.join(" ")
      );
    this.database
      .prepare("DELETE FROM annotation_tags WHERE annotation_id = ?")
      .run(annotation.id);
    this.database
      .prepare("DELETE FROM annotation_concepts WHERE annotation_id = ?")
      .run(annotation.id);
    const insertTag = this.database.prepare(
      "INSERT INTO annotation_tags (annotation_id, tag) VALUES (?, ?)"
    );
    for (const tag of annotation.tags) insertTag.run(annotation.id, tag);
    const insertConcept = this.database.prepare(
      "INSERT INTO annotation_concepts (annotation_id, concept) VALUES (?, ?)"
    );
    for (const concept of annotation.concepts) {
      insertConcept.run(annotation.id, concept);
    }
  }

  public remove(id: string): void {
    this.database.prepare("DELETE FROM annotations WHERE id = ?").run(id);
    this.database.prepare("DELETE FROM annotation_fts WHERE id = ?").run(id);
  }

  public upsertMemoryCell(cell: MemoryCell): void {
    this.database
      .prepare(`
        INSERT INTO memory_cells (
          id, source_annotation_id, source_file, concept, memory_type, summary,
          evidence, confidence, importance, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_annotation_id = excluded.source_annotation_id,
          source_file = excluded.source_file,
          concept = excluded.concept,
          memory_type = excluded.memory_type,
          summary = excluded.summary,
          evidence = excluded.evidence,
          confidence = excluded.confidence,
          importance = excluded.importance,
          updated_at = excluded.updated_at
      `)
      .run(
        cell.id,
        cell.source.annotationId ?? null,
        cell.source.filePath ?? null,
        cell.concept?.name ?? null,
        cell.type,
        cell.summary,
        cell.evidence ?? null,
        cell.confidence ?? null,
        cell.importance ?? null,
        cell.createdAt,
        cell.updatedAt
      );
  }

  public removeMemoryCell(id: string): void {
    this.database.prepare("DELETE FROM memory_cells WHERE id = ?").run(id);
  }

  public async rebuild(
    annotations: Annotation[],
    memoryCells: MemoryCell[] = []
  ): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec("DELETE FROM annotations");
      this.database.exec("DELETE FROM annotation_fts");
      this.database.exec("DELETE FROM memory_cells");
      for (const annotation of annotations) {
        this.upsert(annotation);
      }
      for (const cell of memoryCells) {
        this.upsertMemoryCell(cell);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public query(input: Partial<AnnotationQuery> = {}): AnnotationRow[] {
    const query = annotationQuerySchema.parse(input);
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (query.query) {
      conditions.push(
        "id IN (SELECT id FROM annotation_fts WHERE annotation_fts MATCH ?)"
      );
      parameters.push(toFtsQuery(query.query));
    }
    if (query.file) {
      conditions.push("file_path = ?");
      parameters.push(query.file);
    }
    if (query.status) {
      conditions.push("status = ?");
      parameters.push(query.status);
    }
    if (query.correctness) {
      conditions.push("correctness = ?");
      parameters.push(query.correctness);
    }
    if (query.tag) {
      conditions.push(
        "EXISTS (SELECT 1 FROM annotation_tags WHERE annotation_id = annotations.id AND tag = ?)"
      );
      parameters.push(query.tag);
    }
    if (query.concept) {
      conditions.push(
        "EXISTS (SELECT 1 FROM annotation_concepts WHERE annotation_id = annotations.id AND concept = ?)"
      );
      parameters.push(query.concept);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    parameters.push(query.limit, query.offset);
    return this.database
      .prepare(
        `SELECT id FROM annotations ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...parameters) as unknown as AnnotationRow[];
  }

  public close(): void {
    this.database.close();
  }

  public replaceDocumentSections(filePath: string, chunks: DocumentChunk[]): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare("SELECT id FROM document_sections WHERE file_path = ?")
        .all(filePath) as unknown as Array<{ id: string }>;
      for (const row of existing) {
        this.database.prepare("DELETE FROM document_sections_fts WHERE id = ?").run(row.id);
      }
      this.database
        .prepare("DELETE FROM document_sections WHERE file_path = ?")
        .run(filePath);
      const timestamp = new Date().toISOString();
      for (const chunk of chunks) {
        const id = `${filePath}:${chunk.id}`;
        this.database
          .prepare(
            "INSERT INTO document_sections (id, file_path, heading_path, start_line, end_line, content, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            id,
            filePath,
            JSON.stringify(chunk.headingPath),
            chunk.startLine,
            chunk.endLine,
            chunk.content,
            timestamp
          );
        this.database
          .prepare(
            "INSERT INTO document_sections_fts (id, file_path, heading_path, content) VALUES (?, ?, ?, ?)"
          )
          .run(id, filePath, chunk.headingPath.join(" / "), chunk.content);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  public searchDocument(
    filePath: string,
    query: string,
    limit: number
  ): DocumentSearchHit[] {
    const rows = this.database
      .prepare(`
        SELECT f.id, f.heading_path, snippet(document_sections_fts, 3, '', '', ' ... ', 40) AS excerpt,
               bm25(document_sections_fts) AS rank
        FROM document_sections_fts f
        WHERE document_sections_fts MATCH ? AND f.file_path = ?
        ORDER BY rank
        LIMIT ?
      `)
      .all(toFtsQuery(query), filePath, Math.min(Math.max(limit, 1), 50)) as unknown as Array<{
        id: string;
        heading_path: string;
        excerpt: string;
        rank: number;
      }>;
    return rows.map((row) => ({
      chunkId: row.id.slice(filePath.length + 1),
      headingPath: row.heading_path ? row.heading_path.split(" / ") : [],
      excerpt: row.excerpt,
      score: 1 / (1 + Math.abs(row.rank))
    }));
  }

  private openDatabase(databasePath: string): DatabaseSync {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(databasePath);
      this.initializeDatabase(database);
      return database;
    } catch (error) {
      try {
        database?.close();
      } catch {
        // The damaged database may not be closable.
      }
      for (const suffix of ["", "-wal", "-shm"]) {
        rmSync(`${databasePath}${suffix}`, { force: true });
      }
      database = new DatabaseSync(databasePath);
      this.initializeDatabase(database);
      return database;
    }
  }

  private initializeDatabase(database: DatabaseSync): void {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA foreign_keys = ON");
    const version = (
      database.prepare("PRAGMA user_version").get() as unknown as {
        user_version: number;
      }
    ).user_version;
    if (version !== 0 && version !== AnnotationIndexer.schemaVersion) {
      database.exec(`
        DROP TABLE IF EXISTS annotation_tags;
        DROP TABLE IF EXISTS annotation_concepts;
        DROP TABLE IF EXISTS annotation_fts;
        DROP TABLE IF EXISTS document_sections_fts;
        DROP TABLE IF EXISTS annotations;
        DROP TABLE IF EXISTS memory_cells;
        DROP TABLE IF EXISTS document_sections;
      `);
    }
    this.createSchema(database);
    database.exec(`PRAGMA user_version = ${AnnotationIndexer.schemaVersion}`);
  }

  private createSchema(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        selected_text TEXT NOT NULL,
        user_note TEXT NOT NULL,
        review_summary TEXT,
        status TEXT NOT NULL,
        correctness TEXT,
        tags TEXT NOT NULL,
        concepts TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS annotations_file_path ON annotations(file_path);
      CREATE INDEX IF NOT EXISTS annotations_status ON annotations(status);
      CREATE INDEX IF NOT EXISTS annotations_updated_at ON annotations(updated_at);

      CREATE TABLE IF NOT EXISTS annotation_tags (
        annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (annotation_id, tag)
      );

      CREATE INDEX IF NOT EXISTS annotation_tags_tag ON annotation_tags(tag);

      CREATE TABLE IF NOT EXISTS annotation_concepts (
        annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
        concept TEXT NOT NULL,
        PRIMARY KEY (annotation_id, concept)
      );

      CREATE INDEX IF NOT EXISTS annotation_concepts_concept
        ON annotation_concepts(concept);

      CREATE VIRTUAL TABLE IF NOT EXISTS annotation_fts USING fts5(
        id UNINDEXED,
        selected_text,
        user_note,
        review_summary,
        tags,
        concepts,
        tokenize = 'unicode61'
      );

      CREATE TABLE IF NOT EXISTS memory_cells (
        id TEXT PRIMARY KEY,
        source_annotation_id TEXT,
        source_file TEXT,
        concept TEXT,
        memory_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence TEXT,
        confidence REAL,
        importance REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS document_sections (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        heading_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS document_sections_fts USING fts5(
        id UNINDEXED,
        file_path UNINDEXED,
        heading_path,
        content,
        tokenize = 'unicode61'
      );
    `);
  }
}

function toFtsQuery(value: string): string {
  const terms = value
    .trim()
    .split(/\s+/)
    .map((term) => term.replaceAll('"', '""'))
    .filter(Boolean);
  return terms.map((term) => `"${term}"`).join(" AND ");
}
