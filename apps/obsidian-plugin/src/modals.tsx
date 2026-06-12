import { Modal } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type { App } from "obsidian";
import {
  AnnotationEditor,
  Onboarding,
  type AnnotationSaveMode,
  type OnboardingChoice
} from "@annotation-tutor/ui";
import type { createTranslator } from "@annotation-tutor/ui";

abstract class ReactModal extends Modal {
  protected root: Root | null = null;

  public override onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}

export class AnnotationEditorModal extends ReactModal {
  public constructor(
    app: App,
    private readonly selectedText: string,
    private readonly t: ReturnType<typeof createTranslator>,
    private readonly onSave: (note: string, mode: AnnotationSaveMode) => Promise<void>,
    private readonly initialNote = "",
    private readonly allowReviewActions = true
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.root = createRoot(this.contentEl);
    this.root.render(
      <AnnotationEditor
        selectedText={this.selectedText}
        initialNote={this.initialNote}
        allowReviewActions={this.allowReviewActions}
        t={this.t}
        onSave={(note, mode) => {
          void this.onSave(note, mode).then(() => this.close());
        }}
      />
    );
  }
}

export class OnboardingModal extends ReactModal {
  public constructor(
    app: App,
    private readonly t: ReturnType<typeof createTranslator>,
    private readonly onChoose: (choice: OnboardingChoice) => Promise<void>
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.modalEl.addClass("annotation-tutor-onboarding");
    this.root = createRoot(this.contentEl);
    this.root.render(
      <Onboarding
        t={this.t}
        onChoose={(choice) => {
          void this.onChoose(choice).then(() => this.close());
        }}
      />
    );
  }
}

export class ConfirmRepairModal extends Modal {
  public constructor(
    app: App,
    private readonly confidence: number,
    private readonly onConfirm: () => Promise<void>
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.contentEl.createEl("h3", { text: "Repair annotation anchor?" });
    this.contentEl.createEl("p", {
      text: `A likely source location was found (${Math.round(
        this.confidence * 100
      )}% confidence). The annotation will not move without your confirmation.`
    });
    const actions = this.contentEl.createDiv({ cls: "annotation-tutor-actions" });
    actions.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const confirm = actions.createEl("button", {
      text: "Repair anchor",
      cls: "mod-cta"
    });
    confirm.onclick = () => void this.onConfirm().then(() => this.close());
  }
}

export class ReviewProgressModal extends Modal {
  private messageEl: HTMLElement | null = null;

  public constructor(
    app: App,
    private readonly initialMessage: string,
    private readonly onCancel: () => void
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.contentEl.createEl("h3", { text: "Agent review" });
    this.messageEl = this.contentEl.createEl("p", { text: this.initialMessage });
    const actions = this.contentEl.createDiv({ cls: "annotation-tutor-actions" });
    actions.createEl("button", { text: "Cancel review" }).onclick = () => {
      this.onCancel();
      this.close();
    };
  }

  public setMessage(message: string): void {
    this.messageEl?.setText(message);
  }
}
