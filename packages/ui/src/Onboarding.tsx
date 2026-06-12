import type { createTranslator } from "./i18n.js";

export type OnboardingChoice = "annotations" | "opencode" | "codex" | "developer";

export function Onboarding({
  t,
  onChoose
}: {
  t: ReturnType<typeof createTranslator>;
  onChoose: (choice: OnboardingChoice) => void;
}) {
  return (
    <div className="annotation-tutor-root">
      <h2>{t("onboarding.title")}</h2>
      <p>{t("onboarding.description")}</p>
      <p className="annotation-tutor-muted">
        Agent modes may send the selected text, your explanation, and the source document
        to the model provider already configured in OpenCode or Codex. Annotation Tutor
        does not store a model API key.
      </p>
      <div className="annotation-tutor-list">
        <button onClick={() => onChoose("annotations")}>{t("onboarding.annotations")}</button>
        <button className="mod-cta" onClick={() => onChoose("opencode")}>
          {t("onboarding.opencode")}
        </button>
        <button onClick={() => onChoose("codex")}>{t("onboarding.codex")}</button>
        <button onClick={() => onChoose("developer")}>{t("onboarding.developer")}</button>
      </div>
    </div>
  );
}
