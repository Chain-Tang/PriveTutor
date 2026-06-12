import { createHash } from "node:crypto";
import path from "node:path";
import {
  Editor,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  type EditorPosition,
  type MarkdownFileInfo,
  type TFile
} from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { Annotation } from "@annotation-tutor/domain";
import {
  resolveAnchor,
  VaultPaths
} from "@annotation-tutor/core";
import {
  AnnotationTutorApiClient,
  loadOrCreateTokens,
  loadRuntimeState,
  startHostedRuntime,
  type HostedRuntime
} from "@annotation-tutor/service";
import { writeAgentConfiguration } from "@annotation-tutor/mcp";
import {
  createTranslator,
  type AnnotationSaveMode,
  type OnboardingChoice
} from "@annotation-tutor/ui";
import {
  annotationDecorationExtension,
  setAnnotationDecorations
} from "./decorations.js";
import {
  AnnotationTutorDashboardView,
  DASHBOARD_VIEW_TYPE
} from "./dashboard-view.js";
import {
  AnnotationEditorModal,
  ConfirmRepairModal,
  OnboardingModal,
  ReviewProgressModal
} from "./modals.js";
import {
  AnnotationTutorSettingTab,
  defaultSettings,
  type AnnotationTutorSettings
} from "./settings.js";

type EditorWithCodeMirror = Editor & { cm?: EditorView };

export default class AnnotationTutorPlugin extends Plugin {
  public override settings: AnnotationTutorSettings = { ...defaultSettings };
  public client: AnnotationTutorApiClient | null = null;
  public readonly t = createTranslator(
    document.documentElement.lang || navigator.language || "en"
  );
  private runtime: HostedRuntime | null = null;
  private paths: VaultPaths | null = null;

  public override async onload(): Promise<void> {
    this.settings = { ...defaultSettings, ...(await this.loadData()) };
    this.addSettingTab(new AnnotationTutorSettingTab(this.app, this));
    this.registerEditorExtension(annotationDecorationExtension);
    this.registerView(
      DASHBOARD_VIEW_TYPE,
      (leaf) => new AnnotationTutorDashboardView(leaf, this)
    );
    this.addRibbonIcon("graduation-cap", "Open Annotation Tutor", () => {
      void this.openDashboard();
    });
    this.addCommand({
      id: "create-learning-annotation",
      name: "Create learning annotation",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "l" }],
      editorCallback: (editor, view) => {
        void this.createAnnotationFromEditor(editor, view);
      }
    });
    this.addCommand({
      id: "open-annotation-dashboard",
      name: "Open annotation dashboard",
      callback: () => void this.openDashboard()
    });
    this.addCommand({
      id: "rebuild-annotation-index",
      name: "Rebuild annotation index",
      callback: () => void this.rebuildIndex()
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor, view) => {
        menu.addItem((item) =>
          item
            .setTitle("Add learning annotation")
            .setIcon("highlighter")
            .onClick(() => void this.createAnnotationFromEditor(editor, view))
        );
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => void this.refreshDecorations())
    );

    this.app.workspace.onLayoutReady(() => {
      void this.initializeService().then(async () => {
        this.registerInterval(
          window.setInterval(() => void this.ensureServiceConnection(), 5_000)
        );
        await this.refreshDecorations();
        if (!this.settings.onboardingComplete) {
          new OnboardingModal(this.app, this.t, (choice) =>
            this.completeOnboarding(choice)
          ).open();
        }
      });
    });
  }

  public override async onunload(): Promise<void> {
    await this.runtime?.close();
  }

  public async persistSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  public async updatePermissions(): Promise<void> {
    if (!this.client) return;
    await this.client.updatePermissions({
      allowFullDocumentRead: this.settings.allowFullDocumentRead,
      allowMemoryCellCreation: this.settings.allowMemoryCellCreation,
      allowPersistentReviewWrites: this.settings.allowPersistentReviewWrites
    });
  }

  public async openAnnotation(annotation: Annotation): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(annotation.filePath);
    if (!isMarkdownFile(file)) {
      new Notice(`Source file is unavailable: ${annotation.filePath}`);
      return;
    }
    const markdown = await this.app.vault.read(file);
    const resolution = resolveAnchor(markdown, annotation.anchor);
    if (resolution.strategy === "not-found" || resolution.line === undefined) {
      await this.client?.updateAnnotation(annotation.id, { status: "orphaned" });
      new Notice("The source location could not be found. The annotation was marked orphaned.");
      return;
    }
    if (resolution.requiresConfirmation) {
      new ConfirmRepairModal(this.app, resolution.confidence, async () => {
        const line = resolution.line ?? annotation.anchor.start.line;
        const lineStart = markdown
          .split(/\r?\n/)
          .slice(0, line)
          .reduce((sum, value) => sum + value.length + 1, 0);
        const repaired = await this.client!.updateAnnotation(annotation.id, {
          anchor: {
            ...annotation.anchor,
            start: { line, column: 0, offset: lineStart },
            end: {
              line,
              column: annotation.anchor.selectedText.length,
              offset: lineStart + annotation.anchor.selectedText.length
            }
          },
          status: annotation.review ? "reviewed" : "saved"
        });
        await this.openResolvedAnnotation(repaired, line);
      }).open();
      return;
    }
    await this.openResolvedAnnotation(annotation, resolution.line);
  }

  public async deleteAnnotation(annotation: Annotation): Promise<void> {
    if (annotation.anchor.generatedBlockId) {
      const remaining =
        (
          await this.client?.listAnnotations({
            file: annotation.filePath,
            limit: 200
          })
        )?.filter(
          (candidate) =>
            candidate.id !== annotation.id &&
            candidate.anchor.blockId === annotation.anchor.blockId
        ) ?? [];
      const file = this.app.vault.getAbstractFileByPath(annotation.filePath);
      if (remaining.length === 0 && isMarkdownFile(file)) {
        await this.app.vault.process(file, (content) =>
          content.replace(
            new RegExp(
              `\\s+\\^${escapeRegExp(annotation.anchor.blockId)}(?=\\r?$)`,
              "m"
            ),
            ""
          )
        );
      }
    }
    await this.client?.deleteAnnotation(annotation.id);
    await this.refreshDashboard();
    await this.refreshDecorations();
  }

  public async editAnnotation(annotation: Annotation): Promise<void> {
    new AnnotationEditorModal(
      this.app,
      annotation.anchor.selectedText,
      this.t,
      async (note) => {
        await this.client!.updateAnnotation(annotation.id, {
          userNote: {
            ...annotation.userNote,
            content: note,
            updatedAt: new Date().toISOString()
          }
        });
        await this.refreshDashboard();
      },
      annotation.userNote.content,
      false
    ).open();
  }

  public async deleteReview(annotation: Annotation): Promise<void> {
    await this.client?.deleteReview(annotation.id);
    await this.refreshDashboard();
  }

  public async followUpAnnotation(annotation: Annotation): Promise<void> {
    const provider = this.settings.preferredProvider;
    if (!provider || !annotation.review) {
      new Notice("Choose an Agent and create a review first.");
      return;
    }
    const question = window.prompt("Ask one follow-up question");
    if (!question?.trim()) return;
    try {
      await this.client?.followUp(annotation.id, provider, question.trim());
      await this.refreshDashboard();
    } catch (error) {
      new Notice(
        `Follow-up failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async initializeService(): Promise<void> {
    const vaultRoot = this.getVaultRoot();
    this.paths = new VaultPaths(vaultRoot);
    try {
      this.runtime = await startHostedRuntime({
        vaultRoot,
        owner: "plugin",
        preferredPort: this.settings.preferredPort,
        policy: this.settings
      });
      this.client = new AnnotationTutorApiClient(
        `http://127.0.0.1:${this.runtime.state.port}`,
        this.runtime.tokens.admin
      );
    } catch (error) {
      const state = await loadRuntimeState(this.paths);
      if (!state) throw error;
      const tokens = await loadOrCreateTokens(this.paths);
      this.client = new AnnotationTutorApiClient(
        `http://127.0.0.1:${state.port}`,
        tokens.admin
      );
      await this.client.health();
      new Notice(`Annotation Tutor is using the ${state.owner} service host.`);
    }
  }

  private async ensureServiceConnection(): Promise<void> {
    if (!this.paths || !this.client) return;
    try {
      await this.client.health();
      return;
    } catch {
      const state = await loadRuntimeState(this.paths);
      if (!state) return;
      const tokens = await loadOrCreateTokens(this.paths);
      const nextClient = new AnnotationTutorApiClient(
        `http://127.0.0.1:${state.port}`,
        tokens.admin
      );
      try {
        await nextClient.health();
        this.client = nextClient;
        this.runtime = null;
        new Notice(`Annotation Tutor switched to the ${state.owner} service host.`);
      } catch {
        if (state.owner === "cli") {
          try {
            this.runtime = await startHostedRuntime({
              vaultRoot: this.paths.root,
              owner: "plugin",
              preferredPort: this.settings.preferredPort,
              policy: this.settings
            });
            this.client = new AnnotationTutorApiClient(
              `http://127.0.0.1:${this.runtime.state.port}`,
              this.runtime.tokens.admin
            );
            new Notice("Annotation Tutor restored its embedded service.");
          } catch {
            // The CLI takeover process may still be starting or releasing its lock.
          }
        }
      }
    }
  }

  private async createAnnotationFromEditor(
    editor: Editor,
    view: MarkdownView | MarkdownFileInfo
  ): Promise<void> {
    if (!this.client || !view.file) {
      new Notice("Annotation Tutor service is not ready.");
      return;
    }
    const start = editor.getCursor("from");
    const end = editor.getCursor("to");
    const selectedText = editor.getSelection();
    if (crossesMarkdownBlocks(editor, start, end)) {
      new Notice("MVP annotations cannot cross Markdown blocks.");
      return;
    }
    const block = findBlock(editor, start.line);
    const sourceText =
      selectedText ||
      editor
        .getLine(start.line)
        .replace(/\s+\^[A-Za-z0-9_-]+\s*$/, "")
        .trim();
    if (!sourceText) {
      new Notice("Select text or place the cursor in a non-empty Markdown block.");
      return;
    }
    new AnnotationEditorModal(
      this.app,
      sourceText,
      this.t,
      async (note, mode) =>
        this.saveEditorAnnotation(editor, view.file!, start, end, block, sourceText, note, mode)
    ).open();
  }

  private async saveEditorAnnotation(
    editor: Editor,
    file: TFile,
    start: EditorPosition,
    end: EditorPosition,
    block: { startLine: number; endLine: number },
    selectedText: string,
    note: string,
    mode: AnnotationSaveMode
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const id = `ann-${timestamp.replace(/\D/g, "").slice(0, 14)}-${crypto
      .randomUUID()
      .slice(0, 6)}`;
    const existingBlockId = editor
      .getLine(block.endLine)
      .match(/\s+\^([A-Za-z0-9_-]+)\s*$/)?.[1];
    const blockId = existingBlockId ?? `at-${id}`;
    if (!existingBlockId) {
      editor.setLine(block.endLine, `${editor.getLine(block.endLine)} ^${blockId}`);
    }
    const fullText = editor.getValue();
    const startOffset = editor.posToOffset(start);
    const endOffset =
      start.line === end.line && start.ch === end.ch
        ? startOffset
        : editor.posToOffset(end);
    const annotation: Annotation = {
      id,
      filePath: file.path,
      anchor: {
        kind: startOffset === endOffset ? "block" : "range",
        blockId,
        generatedBlockId: !existingBlockId,
        selectedText,
        contextBefore: fullText.slice(Math.max(startOffset - 160, 0), startOffset),
        contextAfter: fullText.slice(endOffset, endOffset + 160),
        textHash: `sha256:${createHash("sha256").update(selectedText).digest("hex")}`,
        start: { line: start.line, column: start.ch, offset: startOffset },
        end: { line: end.line, column: end.ch, offset: endOffset }
      },
      userNote: { content: note, createdAt: timestamp, updatedAt: timestamp },
      status: mode === "save" ? "saved" : "review_requested",
      tags: [],
      concepts: [],
      memoryCellIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const saved = await this.client!.createAnnotation(annotation);
    await this.refreshDecorations();
    await this.refreshDashboard();
    if (mode === "review-now") {
      await this.reviewAnnotation(saved);
    }
  }

  public async reviewAnnotation(annotation: Annotation): Promise<void> {
    const provider = this.settings.preferredProvider;
    if (!provider) {
      new Notice("Choose OpenCode or Codex in Annotation Tutor settings first.");
      return;
    }
    if (!this.settings.allowFullDocumentRead) {
      new Notice("Enable source-document access in Annotation Tutor settings before review.");
      return;
    }
    const controller = new AbortController();
    const progress = new ReviewProgressModal(
      this.app,
      this.t("review.progress"),
      () => controller.abort()
    );
    progress.open();
    try {
      if (annotation.status !== "review_requested") {
        annotation = await this.client!.updateAnnotation(annotation.id, {
          status: "review_requested"
        });
      }
      await this.client!.runReview(
        annotation.id,
        provider,
        (message) => progress.setMessage(message),
        controller.signal
      );
      progress.setMessage("Review saved.");
      setTimeout(() => progress.close(), 1500);
      await this.refreshDashboard();
    } catch (error) {
      progress.close();
      if (controller.signal.aborted) {
        new Notice("Agent review cancelled.");
        return;
      }
      new Notice(
        `Agent review failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async completeOnboarding(choice: OnboardingChoice): Promise<void> {
    this.settings.onboardingComplete = true;
    if (choice === "opencode" || choice === "codex") {
      this.settings.preferredProvider = choice;
      this.settings.allowFullDocumentRead = true;
      await this.updatePermissions();
      if (this.paths && this.client) {
        const state = this.runtime?.state ?? (await loadRuntimeState(this.paths));
        const tokens = this.runtime?.tokens ?? (await loadOrCreateTokens(this.paths));
        if (state) {
          await writeAgentConfiguration(
            choice,
            this.paths.root,
            `http://127.0.0.1:${state.port}/mcp`,
            tokens.agentReadOnly
          );
        }
      }
    }
    await this.persistSettings();
    new Notice(
      choice === "annotations"
        ? "Annotation-only mode enabled."
        : "Annotation Tutor setup completed."
    );
  }

  private async openDashboard(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    await this.refreshDashboard();
  }

  private async refreshDashboard(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof AnnotationTutorDashboardView) await view.refresh();
    }
  }

  private async refreshDecorations(): Promise<void> {
    if (!this.client) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;
    const annotations = await this.client.listAnnotations({
      file: view.file.path,
      limit: 200
    });
    (view.editor as EditorWithCodeMirror).cm?.dispatch({
      effects: setAnnotationDecorations.of(annotations)
    });
  }

  private async openResolvedAnnotation(
    annotation: Annotation,
    line: number
  ): Promise<void> {
    await this.app.workspace.openLinkText(annotation.filePath, "", false);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    view.editor.setCursor({ line, ch: annotation.anchor.start.column });
    view.editor.scrollIntoView(
      {
        from: { line, ch: annotation.anchor.start.column },
        to: { line, ch: annotation.anchor.end.column }
      },
      true
    );
  }

  private async rebuildIndex(): Promise<void> {
    if (!this.runtime) {
      new Notice("The CLI service owns this Vault; run annotation-tutor rebuild-index.");
      return;
    }
    await this.runtime.service.initialize();
    new Notice("Annotation index rebuilt.");
  }

  private getVaultRoot(): string {
    const adapter = this.app.vault.adapter as { basePath?: string };
    if (!adapter.basePath) {
      throw new Error("Annotation Tutor requires a desktop file-system Vault.");
    }
    return path.resolve(adapter.basePath);
  }
}

function crossesMarkdownBlocks(
  editor: Editor,
  start: EditorPosition,
  end: EditorPosition
): boolean {
  for (let line = start.line; line <= end.line; line += 1) {
    if (line > start.line && line < end.line && editor.getLine(line).trim() === "") {
      return true;
    }
  }
  return false;
}

function findBlock(editor: Editor, line: number): { startLine: number; endLine: number } {
  let startLine = line;
  let endLine = line;
  while (startLine > 0 && editor.getLine(startLine - 1).trim() !== "") startLine -= 1;
  while (
    endLine < editor.lineCount() - 1 &&
    editor.getLine(endLine + 1).trim() !== ""
  ) {
    endLine += 1;
  }
  return { startLine, endLine };
}

function isMarkdownFile(file: unknown): file is TFile {
  return (
    typeof file === "object" &&
    file !== null &&
    "extension" in file &&
    (file as { extension: unknown }).extension === "md"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
