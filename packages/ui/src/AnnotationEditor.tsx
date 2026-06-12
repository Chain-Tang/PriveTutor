import { useState } from "react";
import type { createTranslator } from "./i18n.js";

export type AnnotationSaveMode = "save" | "review-later" | "review-now";

type AnnotationEditorProps = {
  selectedText: string;
  initialNote?: string;
  allowReviewActions?: boolean;
  t: ReturnType<typeof createTranslator>;
  onSave: (note: string, mode: AnnotationSaveMode) => void;
};

export function AnnotationEditor({
  selectedText,
  initialNote = "",
  allowReviewActions = true,
  t,
  onSave
}: AnnotationEditorProps) {
  const [note, setNote] = useState(initialNote);
  const disabled = note.trim().length === 0;
  return (
    <div className="annotation-tutor-root">
      <h3>{t("annotation.note")}</h3>
      <p className="annotation-tutor-muted">{t("annotation.selected")}</p>
      <blockquote>{selectedText}</blockquote>
      <textarea
        rows={8}
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
        placeholder="I understand this to mean..."
      />
      <div className="annotation-tutor-actions">
        <button disabled={disabled} onClick={() => onSave(note.trim(), "save")}>
          {t("annotation.save")}
        </button>
        {allowReviewActions ? (
          <>
            <button disabled={disabled} onClick={() => onSave(note.trim(), "review-later")}>
              {t("annotation.later")}
            </button>
            <button className="mod-cta" disabled={disabled} onClick={() => onSave(note.trim(), "review-now")}>
              {t("annotation.now")}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
