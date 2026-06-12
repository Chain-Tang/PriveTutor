import { ItemView, type WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import { Dashboard } from "@annotation-tutor/ui";
import type AnnotationTutorPlugin from "./main.js";

export const DASHBOARD_VIEW_TYPE = "annotation-tutor-dashboard";

export class AnnotationTutorDashboardView extends ItemView {
  private root: Root | null = null;

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: AnnotationTutorPlugin
  ) {
    super(leaf);
  }

  public override getViewType(): string {
    return DASHBOARD_VIEW_TYPE;
  }

  public override getDisplayText(): string {
    return "Annotation Tutor";
  }

  public override getIcon(): string {
    return "graduation-cap";
  }

  public override async onOpen(): Promise<void> {
    this.root = createRoot(this.contentEl);
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.root || !this.plugin.client) return;
    const annotations = await this.plugin.client.listAnnotations({ limit: 200 });
    this.root.render(
      <Dashboard
        annotations={annotations}
        t={this.plugin.t}
        onOpen={(annotation) => void this.plugin.openAnnotation(annotation)}
        onEdit={(annotation) => void this.plugin.editAnnotation(annotation)}
        onReview={(annotation) => void this.plugin.reviewAnnotation(annotation)}
        onFollowUp={(annotation) => void this.plugin.followUpAnnotation(annotation)}
        onDeleteReview={(annotation) => void this.plugin.deleteReview(annotation)}
        onDelete={(annotation) => void this.plugin.deleteAnnotation(annotation)}
      />
    );
  }

  public override async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }
}
