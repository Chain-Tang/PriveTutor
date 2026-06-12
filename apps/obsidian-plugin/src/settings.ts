import {
  App,
  PluginSettingTab,
  Setting
} from "obsidian";
import type { PermissionPolicy } from "@annotation-tutor/domain";
import type AnnotationTutorPlugin from "./main.js";

export type AnnotationTutorSettings = PermissionPolicy & {
  onboardingComplete: boolean;
  preferredProvider: "opencode" | "codex" | null;
  preferredPort: number;
};

export const defaultSettings: AnnotationTutorSettings = {
  onboardingComplete: false,
  preferredProvider: null,
  preferredPort: 37_891,
  allowPersistentReviewWrites: false,
  allowMemoryCellCreation: false,
  allowFullDocumentRead: false
};

export class AnnotationTutorSettingTab extends PluginSettingTab {
  public constructor(
    app: App,
    private readonly plugin: AnnotationTutorPlugin
  ) {
    super(app, plugin);
  }

  public override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Preferred Agent")
      .setDesc("Annotation Tutor never silently switches to a different Agent.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("", "Not selected")
          .addOption("opencode", "OpenCode")
          .addOption("codex", "Codex")
          .setValue(this.plugin.settings.preferredProvider ?? "")
          .onChange(async (value) => {
            this.plugin.settings.preferredProvider =
              value === "opencode" || value === "codex" ? value : null;
            await this.plugin.persistSettings();
          })
      );

    this.addPermissionToggle(
      containerEl,
      "Read complete source documents",
      "Allows the selected local Agent to read only the source document belonging to an annotation.",
      "allowFullDocumentRead"
    );
    this.addPermissionToggle(
      containerEl,
      "Persistent review writes",
      "Allows reviews beyond a single review_requested annotation.",
      "allowPersistentReviewWrites"
    );
    this.addPermissionToggle(
      containerEl,
      "Create memory cells",
      "Allows Agents to create durable learning-memory files.",
      "allowMemoryCellCreation"
    );
  }

  private addPermissionToggle(
    container: HTMLElement,
    name: string,
    description: string,
    key: keyof PermissionPolicy
  ): void {
    new Setting(container)
      .setName(name)
      .setDesc(description)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
          this.plugin.settings[key] = value;
          await this.plugin.persistSettings();
          await this.plugin.updatePermissions();
        })
      );
  }
}
