import {
  AnnotationTutorError,
  agentReviewSchema,
  annotationQuerySchema,
  annotationSchema,
  memoryCellSchema,
  type AgentReview,
  type Annotation,
  type AnnotationQuery,
  type MemoryCell,
  type RecentLearningContext
} from "@annotation-tutor/domain";
import type { AnnotationIndexer } from "./indexer.js";
import type { PermissionService } from "./permissions.js";
import type {
  AnnotationStore,
  LearningContextStore,
  MemoryCellStore
} from "./storage.js";
import type { DocumentContextService } from "./documents.js";

export type AnnotationTutorServiceDependencies = {
  annotations: AnnotationStore;
  memoryCells: MemoryCellStore;
  indexer: AnnotationIndexer;
  documents: DocumentContextService;
  permissions: PermissionService;
  learningContext?: LearningContextStore;
};

export class AnnotationTutorService {
  public readonly documents: DocumentContextService;
  public readonly permissions: PermissionService;

  public constructor(private readonly dependencies: AnnotationTutorServiceDependencies) {
    this.documents = dependencies.documents;
    this.permissions = dependencies.permissions;
  }

  public async initialize(): Promise<void> {
    const annotations = await this.dependencies.annotations.list();
    await this.dependencies.indexer.rebuild(
      annotations,
      await this.dependencies.memoryCells.list()
    );
    const indexedFiles = new Set<string>();
    for (const annotation of annotations) {
      if (indexedFiles.has(annotation.filePath)) continue;
      indexedFiles.add(annotation.filePath);
      try {
        await this.dependencies.documents.listChunks(annotation.id);
      } catch (error) {
        if (!(error instanceof AnnotationTutorError) || error.code !== "NOT_FOUND") {
          throw error;
        }
      }
    }
  }

  public async listAnnotations(
    input: Partial<AnnotationQuery> = {}
  ): Promise<Annotation[]> {
    const query = annotationQuerySchema.parse(input);
    const rows = this.dependencies.indexer.query(query);
    return Promise.all(rows.map(({ id }) => this.dependencies.annotations.get(id)));
  }

  public getAnnotation(id: string): Promise<Annotation> {
    return this.dependencies.annotations.get(id);
  }

  public async createAnnotation(input: Annotation): Promise<Annotation> {
    const annotation = annotationSchema.parse(input);
    try {
      await this.dependencies.annotations.get(annotation.id);
      throw new AnnotationTutorError(
        "CONFLICT",
        `Annotation already exists: ${annotation.id}`,
        409
      );
    } catch (error) {
      if (!(error instanceof AnnotationTutorError) || error.code !== "NOT_FOUND") {
        throw error;
      }
    }
    await this.dependencies.annotations.save(annotation);
    this.dependencies.indexer.upsert(annotation);
    await this.refreshLearningContext();
    return annotation;
  }

  public async updateAnnotation(
    id: string,
    patch: Partial<Annotation>
  ): Promise<Annotation> {
    const existing = await this.getAnnotation(id);
    const updated = annotationSchema.parse({
      ...existing,
      ...patch,
      id,
      anchor: patch.anchor ? { ...existing.anchor, ...patch.anchor } : existing.anchor,
      userNote: patch.userNote
        ? { ...existing.userNote, ...patch.userNote }
        : existing.userNote,
      updatedAt: new Date().toISOString()
    });
    await this.dependencies.annotations.save(updated);
    this.dependencies.indexer.upsert(updated);
    await this.refreshLearningContext();
    return updated;
  }

  public async deleteAnnotation(id: string): Promise<void> {
    await this.dependencies.annotations.delete(id);
    this.dependencies.indexer.remove(id);
    await this.refreshLearningContext();
  }

  public async writeReview(id: string, input: AgentReview): Promise<Annotation> {
    const annotation = await this.getAnnotation(id);
    if (!this.dependencies.permissions.canWriteReview(annotation)) {
      throw new AnnotationTutorError(
        "FORBIDDEN",
        "Agent review write is not permitted for this annotation",
        403
      );
    }
    const review = agentReviewSchema.parse(input);
    return this.updateAnnotation(id, {
      review,
      status: "reviewed"
    });
  }

  public async saveFollowUp(
    id: string,
    followUp: NonNullable<AgentReview["followUp"]>
  ): Promise<Annotation> {
    const annotation = await this.getAnnotation(id);
    if (!annotation.review) {
      throw new AnnotationTutorError(
        "CONFLICT",
        "A follow-up requires an existing review",
        409
      );
    }
    if (annotation.review.followUp) {
      throw new AnnotationTutorError(
        "CONFLICT",
        "This review already has its one persisted follow-up",
        409
      );
    }
    return this.updateAnnotation(id, {
      review: agentReviewSchema.parse({ ...annotation.review, followUp })
    });
  }

  public async deleteReview(id: string): Promise<Annotation> {
    const annotation = await this.getAnnotation(id);
    if (!annotation.review) return annotation;
    return this.updateAnnotation(id, {
      review: undefined,
      status: "saved"
    });
  }

  public async createMemoryCell(input: MemoryCell): Promise<MemoryCell> {
    if (!this.dependencies.permissions.canCreateMemoryCell()) {
      throw new AnnotationTutorError(
        "FORBIDDEN",
        "Memory cell creation is not permitted",
        403
      );
    }
    const parsed = memoryCellSchema.parse(input);
    if (parsed.source.annotationId) {
      await this.getAnnotation(parsed.source.annotationId);
    }
    try {
      await this.dependencies.memoryCells.get(parsed.id);
      throw new AnnotationTutorError(
        "CONFLICT",
        `Memory cell already exists: ${parsed.id}`,
        409
      );
    } catch (error) {
      if (!(error instanceof AnnotationTutorError) || error.code !== "NOT_FOUND") {
        throw error;
      }
    }
    const cell = await this.dependencies.memoryCells.save(parsed);
    this.dependencies.indexer.upsertMemoryCell(cell);
    await this.linkMemoryCell(cell.source.annotationId, cell.id);
    await this.refreshLearningContext();
    return cell;
  }

  public listMemoryCells(): Promise<MemoryCell[]> {
    return this.dependencies.memoryCells.list();
  }

  public getMemoryCell(id: string): Promise<MemoryCell> {
    return this.dependencies.memoryCells.get(id);
  }

  public async updateMemoryCell(
    id: string,
    patch: Partial<MemoryCell>
  ): Promise<MemoryCell> {
    const existing = await this.getMemoryCell(id);
    const updated = memoryCellSchema.parse({
      ...existing,
      ...patch,
      id,
      source: patch.source
        ? { ...existing.source, ...patch.source }
        : existing.source,
      concept: patch.concept
        ? { ...existing.concept, ...patch.concept }
        : existing.concept,
      updatedAt: new Date().toISOString()
    });
    if (updated.source.annotationId) {
      await this.getAnnotation(updated.source.annotationId);
    }
    await this.dependencies.memoryCells.save(updated);
    this.dependencies.indexer.upsertMemoryCell(updated);
    if (existing.source.annotationId !== updated.source.annotationId) {
      await this.unlinkMemoryCell(existing.source.annotationId, id);
      await this.linkMemoryCell(updated.source.annotationId, id);
    }
    await this.refreshLearningContext();
    return updated;
  }

  public async deleteMemoryCell(id: string): Promise<void> {
    const existing = await this.getMemoryCell(id);
    await this.dependencies.memoryCells.delete(id);
    this.dependencies.indexer.removeMemoryCell(id);
    await this.unlinkMemoryCell(existing.source.annotationId, id);
    await this.refreshLearningContext();
  }

  public async exportMarkdown(): Promise<string> {
    const annotations = await this.dependencies.annotations.list();
    const sections = annotations.map((annotation) => {
      const review = annotation.review
        ? `\n**Review (${annotation.review.provider}):** ${annotation.review.summary}\n`
        : "";
      return [
        `## ${annotation.id}`,
        "",
        `- Source: \`${annotation.filePath}\``,
        `- Status: ${annotation.status}`,
        `- Selected text: ${annotation.anchor.selectedText}`,
        "",
        annotation.userNote.content,
        review
      ].join("\n");
    });
    return `# Annotation Tutor Export\n\n${sections.join("\n\n")}\n`;
  }

  public async getRecentLearningContext(): Promise<RecentLearningContext> {
    const annotations = (await this.dependencies.annotations.list())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 50);
    const reviewed = annotations.filter((annotation) => annotation.review);
    return {
      recentlyStudied: unique(
        annotations.flatMap((annotation) =>
          annotation.concepts.length > 0 ? annotation.concepts : annotation.tags
        )
      ).slice(0, 20),
      activeConfusions: unique(
        reviewed.flatMap((annotation) => [
          ...(annotation.review?.missingConcepts ?? []),
          ...(annotation.review?.weaknesses ?? [])
        ])
      ).slice(0, 20),
      highValueAnnotations: reviewed.slice(0, 20).map((annotation) => annotation.id),
      suggestedAgentBehavior: [
        "Ask the learner to explain their understanding before correcting it.",
        "Cite the annotation ID and source Markdown file.",
        "Separate source-document evidence from model background knowledge."
      ],
      updatedAt: new Date().toISOString()
    };
  }

  private async refreshLearningContext(): Promise<void> {
    if (this.dependencies.learningContext) {
      await this.dependencies.learningContext.save(
        await this.getRecentLearningContext()
      );
    }
  }

  private async linkMemoryCell(
    annotationId: string | undefined,
    memoryCellId: string
  ): Promise<void> {
    if (!annotationId) return;
    const annotation = await this.getAnnotation(annotationId);
    if (!annotation.memoryCellIds.includes(memoryCellId)) {
      await this.updateAnnotation(annotationId, {
        memoryCellIds: [...annotation.memoryCellIds, memoryCellId]
      });
    }
  }

  private async unlinkMemoryCell(
    annotationId: string | undefined,
    memoryCellId: string
  ): Promise<void> {
    if (!annotationId) return;
    try {
      const annotation = await this.getAnnotation(annotationId);
      if (annotation.memoryCellIds.includes(memoryCellId)) {
        await this.updateAnnotation(annotationId, {
          memoryCellIds: annotation.memoryCellIds.filter(
            (candidate) => candidate !== memoryCellId
          )
        });
      }
    } catch (error) {
      if (!(error instanceof AnnotationTutorError) || error.code !== "NOT_FOUND") {
        throw error;
      }
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
