// Inline translation + background pre-translation (Alt+T), extracted from the
// plugin so main.ts stays focused. Owns the per-file glossary cache and the
// status-bar progress counter; the engine call (`captureText`) and shared
// services are injected so this stays a cohesive unit.

import { type App, type Editor, type EditorPosition, Notice, setIcon, TFile } from "obsidian";
import { getLocale, t } from "./i18n.js";
import type { AnnotationTutorLiteSettings } from "./settings-config.js";
import type { ReviewOutcome } from "./review-outcome.js";
import { lineTextWithoutBlockId } from "./editor.js";
import {
  applyGlossary,
  buildFileGlossary,
  buildGlossaryPrompt,
  contentHash,
  lookupGloss,
  mergeGlossaryEntry,
  parseGlossary,
  segmentDocument,
  MAX_PRETRANSLATE_BATCHES,
  type FileGlossary,
  type GlossaryEntry
} from "./pretranslate.js";
import {
  buildPassageGlossPrompt,
  buildWordGlossPrompt,
  classifyTranslateSelection,
  cleanGloss,
  formatWordGloss,
  nativeLanguageName,
  stripWrapper,
  type TranslateMode
} from "./translate.js";

/** Outcome of resolving a selection's gloss through a live model call. */
type LiveGloss =
  | { kind: "ok"; replacement: string; word?: GlossaryEntry }
  | { kind: "noop" }
  | { kind: "fail"; outcome: ReviewOutcome };

export type TranslationDeps = {
  app: App;
  /** Status-bar element for the compact "done/total" pre-translation counter. */
  statusBar: HTMLElement;
  settings: () => AnnotationTutorLiteSettings;
  chatTimeoutMs: () => number;
  /** One one-shot generation through the configured review engine. */
  captureText: (prompt: string, timeoutMs: number) => Promise<ReviewOutcome>;
};

export class TranslationController {
  // Per-file glossaries, keyed by Vault path, so Alt+T can gloss instantly.
  private readonly glossaryCache = new Map<string, FileGlossary>();
  // File paths with a pre-translation pass in flight, to avoid duplicate runs.
  private readonly pretranslating = new Set<string>();

  public constructor(private readonly deps: TranslationDeps) {}

  /** A renamed/moved file keeps its cached glossary; a deleted one drops it. */
  public onFileDeleted(path: string): void {
    this.glossaryCache.delete(path);
  }

  public onFileRenamed(oldPath: string, newPath: string): void {
    const moved = this.glossaryCache.get(oldPath);
    this.glossaryCache.delete(oldPath);
    if (moved) this.glossaryCache.set(newPath, moved);
  }

  private dictionaryLanguageName(): string {
    return this.deps.settings().dictionaryLanguage.trim() || nativeLanguageName(getLocale());
  }

  /**
   * The inline replacement for a selection from the active file's cached
   * pre-translation, or null when the cache does not cover it (so the caller
   * falls back to a live call). Pure: no editor/file/notice side effects, so the
   * editor and Reading-view paths can each apply it their own way.
   */
  private glossFromCache(selection: string, mode: TranslateMode): string | null {
    const file = this.deps.app.workspace.getActiveFile();
    const glossary = file ? this.glossaryCache.get(file.path) : undefined;
    if (!glossary) return null;
    if (mode === "word") {
      const gloss = lookupGloss(glossary, selection);
      if (gloss) {
        const replacement = formatWordGloss(selection, gloss);
        return replacement === selection ? null : replacement;
      }
    }
    const glossed = applyGlossary(selection, glossary);
    return glossed !== selection ? glossed : null;
  }

  /**
   * Resolve a selection's gloss with one live model call, formatting it for the
   * mode (a single "word (meaning)" or a passage with inline glosses). Shared by
   * the editor and Reading-view paths; neither touches the document here.
   */
  private async liveGloss(
    selection: string,
    contextLine: string,
    mode: TranslateMode,
    target: string
  ): Promise<LiveGloss> {
    const prompt =
      mode === "word"
        ? buildWordGlossPrompt(selection.trim(), contextLine, target)
        : buildPassageGlossPrompt(selection, target);
    const outcome = await this.deps.captureText(prompt, this.deps.chatTimeoutMs());
    if (outcome.kind !== "ok") return { kind: "fail", outcome };
    const wordGloss = mode === "word" ? cleanGloss(outcome.reviewText) : "";
    const replacement =
      mode === "word"
        ? formatWordGloss(selection, wordGloss)
        : stripWrapper(outcome.reviewText);
    if (!replacement.trim() || replacement === selection) return { kind: "noop" };
    const word =
      mode === "word" && wordGloss
        ? { surface: selection.trim(), gloss: wordGloss }
        : undefined;
    return word ? { kind: "ok", replacement, word } : { kind: "ok", replacement };
  }

  /**
   * Add a live word gloss to the active file's cached glossary so a repeat Alt+T
   * on the same term answers from cache. No-op when the file has no glossary yet.
   */
  private cacheWordGloss(surface: string, gloss: string): void {
    if (!surface || !gloss) return;
    const file = this.deps.app.workspace.getActiveFile();
    if (!file) return;
    const glossary = this.glossaryCache.get(file.path);
    if (!glossary) return;
    this.glossaryCache.set(file.path, mergeGlossaryEntry(glossary, { surface, gloss }));
  }

  /** File-open hook: pre-translate the document when the feature is enabled. */
  public async maybePretranslate(file: TFile): Promise<void> {
    if (!this.deps.settings().pretranslateOnOpen) return;
    // Don't auto-translate the plugin's own generated memory/library notes.
    const root = this.deps.settings().memoryRoot;
    if (root && (file.path === root || file.path.startsWith(`${root}/`))) return;
    await this.pretranslateFile(file, false);
  }

  /** Manual command: (re)build the pre-translation glossary for the active note. */
  public async pretranslateActiveFile(): Promise<void> {
    const file = this.deps.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice(t("notice.openMdFirst"));
      return;
    }
    await this.pretranslateFile(file, true);
  }

  /**
   * Gloss a document in the background into a cached word→meaning glossary so
   * Alt+T can answer instantly. Skips work when the cache already matches the
   * file's content, and aborts quietly when the engine needs a key (unless the
   * user invoked it manually). The live Alt+T path covers anything this misses.
   */
  private async pretranslateFile(file: TFile, manual: boolean): Promise<void> {
    if (this.pretranslating.has(file.path)) {
      if (manual) new Notice(t("notice.pretranslateBusy"));
      return;
    }
    const content = await this.deps.app.vault.cachedRead(file);
    const hash = contentHash(content);
    const existing = this.glossaryCache.get(file.path);
    if (existing && existing.hash === hash && existing.complete) {
      if (manual) {
        new Notice(t("notice.pretranslateUpToDate", { count: existing.entries.length }));
      }
      return;
    }
    const batches = segmentDocument(
      content,
      this.deps.settings().pretranslateChunkChars
    ).slice(0, MAX_PRETRANSLATE_BATCHES);
    if (batches.length === 0) {
      this.glossaryCache.set(file.path, buildFileGlossary(hash, []));
      if (manual) new Notice(t("notice.pretranslateEmpty"));
      return;
    }
    this.pretranslating.add(file.path);
    const target = this.dictionaryLanguageName();
    this.setPretranslateStatus(0, batches.length);
    const entries: GlossaryEntry[] = [];
    let done = 0;
    let failed = 0;
    let needsKey = false;
    try {
      for (const batch of batches) {
        let outcome: ReviewOutcome;
        try {
          outcome = await this.deps.captureText(
            buildGlossaryPrompt(batch, target),
            this.deps.chatTimeoutMs()
          );
        } catch (error) {
          console.error("[Annotation Tutor Lite] pre-translate batch error", error);
          outcome = {
            kind: "failed",
            detail: error instanceof Error ? error.message : String(error)
          };
        }
        if (outcome.kind === "needs-key") {
          needsKey = true;
          break;
        }
        if (outcome.kind === "ok") {
          entries.push(...parseGlossary(outcome.reviewText));
        } else {
          failed += 1;
        }
        done += 1;
        // Publish progress so far so Alt+T can already use the terms found.
        this.glossaryCache.set(file.path, buildFileGlossary(hash, entries, false));
        this.setPretranslateStatus(done, batches.length);
      }
    } finally {
      this.pretranslating.delete(file.path);
      if (this.pretranslating.size === 0) this.clearPretranslateStatus();
    }
    if (needsKey) {
      this.glossaryCache.set(file.path, buildFileGlossary(hash, entries));
      if (manual) new Notice(t("notice.apiKeyMissing"));
      return;
    }
    const glossary = buildFileGlossary(hash, entries);
    this.glossaryCache.set(file.path, glossary);
    const count = glossary.entries.length;
    // Auto runs stay silent — the status-bar counter was the only hint needed.
    if (!manual) return;
    if (count > 0) {
      new Notice(
        failed > 0
          ? t("notice.pretranslatePartial", { count, failed })
          : t("notice.pretranslateDone", { count })
      );
    } else if (failed > 0) {
      new Notice(t("notice.pretranslateFailed"));
    } else {
      new Notice(t("notice.pretranslateEmpty"));
    }
  }

  /** Show a compact "done/total" pre-translation counter in the status bar. */
  private setPretranslateStatus(done: number, total: number): void {
    const el = this.deps.statusBar;
    el.empty();
    if (total <= 0) return;
    setIcon(el.createSpan({ cls: "atl-pretranslate-status-icon" }), "languages");
    el.createSpan({ text: ` ${done}/${total}` });
    el.setAttribute("aria-label", t("status.pretranslate"));
  }

  private clearPretranslateStatus(): void {
    this.deps.statusBar.empty();
  }

  /**
   * Alt+T in the editor (Live Preview / Source): gloss the selection inline for
   * immersive reading. A single word/term becomes "word (meaning)"; a passage
   * gets every foreign word glossed in place.
   */
  public async translateSelection(editor: Editor): Promise<void> {
    const selection = editor.getSelection();
    if (!selection.trim()) {
      new Notice(t("notice.translateSelect"));
      return;
    }
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const mode = classifyTranslateSelection(selection);

    // Fast path: answer from the pre-translation cache when it covers the
    // selection. Otherwise fall through to a live model call.
    const cached = this.glossFromCache(selection, mode);
    if (cached && this.replaceSelection(editor, from, to, selection, cached)) {
      new Notice(t("notice.translateDone"));
      return;
    }

    const progress = new Notice(t("notice.translating"), 0);
    try {
      const result = await this.liveGloss(
        selection,
        lineTextWithoutBlockId(editor.getLine(from.line)),
        mode,
        this.dictionaryLanguageName()
      );
      if (!this.handleLiveOutcome(result)) return;
      if (!this.replaceSelection(editor, from, to, selection, result.replacement)) {
        new Notice(t("notice.translateFailed", { detail: t("chat.edit.notLocated") }));
        return;
      }
      // Self-healing cache: a missed word is glossed live once, then remembered.
      if (result.word) this.cacheWordGloss(result.word.surface, result.word.gloss);
      new Notice(t("notice.translateDone"));
    } catch (error) {
      new Notice(
        t("notice.translateFailed", {
          detail: error instanceof Error ? error.message : String(error)
        })
      );
    } finally {
      progress.hide();
    }
  }

  /**
   * Alt+T in Reading view, where there is no editor: translate the rendered
   * selection and write the gloss back into the source file (the view then
   * re-renders with it). The first matching occurrence is glossed, mirroring how
   * Reading-view annotations locate their text.
   */
  public async translateReadingSelection(
    file: TFile,
    rawSelection: string
  ): Promise<void> {
    const selection = rawSelection.trim();
    if (!selection) {
      new Notice(t("notice.translateSelect"));
      return;
    }
    const mode = classifyTranslateSelection(selection);

    const cached = this.glossFromCache(selection, mode);
    if (cached && (await this.replaceInFile(file, selection, cached))) {
      new Notice(t("notice.translateDone"));
      return;
    }

    const progress = new Notice(t("notice.translating"), 0);
    try {
      const content = await this.deps.app.vault.cachedRead(file);
      const result = await this.liveGloss(
        selection,
        sourceLineContaining(content, selection) ?? selection,
        mode,
        this.dictionaryLanguageName()
      );
      if (!this.handleLiveOutcome(result)) return;
      if (!(await this.replaceInFile(file, selection, result.replacement))) {
        new Notice(t("notice.translateFailed", { detail: t("chat.edit.notLocated") }));
        return;
      }
      if (result.word) this.cacheWordGloss(result.word.surface, result.word.gloss);
      new Notice(t("notice.translateDone"));
    } catch (error) {
      new Notice(
        t("notice.translateFailed", {
          detail: error instanceof Error ? error.message : String(error)
        })
      );
    } finally {
      progress.hide();
    }
  }

  /**
   * Narrow a live-gloss outcome to the success case, showing the right notice for
   * a failure or an empty result. Returns true only when there is a replacement.
   */
  private handleLiveOutcome(
    result: LiveGloss
  ): result is Extract<LiveGloss, { kind: "ok" }> {
    if (result.kind === "fail") {
      this.noticeForTranslate(result.outcome);
      return false;
    }
    if (result.kind === "noop") {
      new Notice(t("notice.translateFailed", { detail: t("notice.translateEmpty") }));
      return false;
    }
    return true;
  }

  /** Replace the first occurrence of `original` in `file`; true when found. */
  private async replaceInFile(
    file: TFile,
    original: string,
    replacement: string
  ): Promise<boolean> {
    let found = false;
    await this.deps.app.vault.process(file, (data) => {
      const idx = data.indexOf(original);
      if (idx === -1) return data;
      found = true;
      return data.slice(0, idx) + replacement + data.slice(idx + original.length);
    });
    return found;
  }

  /** Replace `original` at the captured range, re-locating it by text if it shifted. */
  private replaceSelection(
    editor: Editor,
    from: EditorPosition,
    to: EditorPosition,
    original: string,
    replacement: string
  ): boolean {
    if (editor.getRange(from, to) === original) {
      editor.replaceRange(replacement, from, to);
      return true;
    }
    const idx = editor.getValue().indexOf(original);
    if (idx === -1) return false;
    editor.replaceRange(
      replacement,
      editor.offsetToPos(idx),
      editor.offsetToPos(idx + original.length)
    );
    return true;
  }

  private noticeForTranslate(outcome: ReviewOutcome): void {
    switch (outcome.kind) {
      case "needs-key":
        new Notice(t("notice.apiKeyMissing"));
        return;
      case "timeout":
        new Notice(t("notice.translateFailed", { detail: t("notice.translateTimeout") }));
        return;
      case "failed":
        new Notice(t("notice.translateFailed", { detail: outcome.detail }));
        return;
      case "empty":
        new Notice(t("notice.translateFailed", { detail: t("notice.translateEmpty") }));
        return;
    }
  }
}

/** The source line that contains `selection`, block id stripped, or null. */
function sourceLineContaining(content: string, selection: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    if (line.includes(selection)) return lineTextWithoutBlockId(line);
  }
  return null;
}
