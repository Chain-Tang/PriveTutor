import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  type DecorationSet
} from "@codemirror/view";
import type { Annotation } from "@annotation-tutor/domain";

export const setAnnotationDecorations = StateEffect.define<Annotation[]>();

export const annotationDecorationExtension = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setAnnotationDecorations)) {
        return buildDecorations(transaction.state.doc, effect.value);
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field)
});

function buildDecorations(
  document: { lines: number; line: (number: number) => { from: number; to: number } },
  annotations: Annotation[]
): DecorationSet {
  const ranges = annotations
    .flatMap((annotation) => {
      const startLineNumber = Math.min(annotation.anchor.start.line + 1, document.lines);
      const endLineNumber = Math.min(annotation.anchor.end.line + 1, document.lines);
      const startLine = document.line(Math.max(startLineNumber, 1));
      const endLine = document.line(Math.max(endLineNumber, 1));
      if (annotation.anchor.kind === "block") {
        return [
          Decoration.line({
            class: "annotation-tutor-block",
            attributes: { "data-annotation-id": annotation.id }
          }).range(startLine.from)
        ];
      }
      const from = Math.min(startLine.from + annotation.anchor.start.column, startLine.to);
      const to = Math.max(
        from,
        Math.min(endLine.from + annotation.anchor.end.column, endLine.to)
      );
      return [
        Decoration.mark({
          class: "annotation-tutor-underline",
          attributes: { "data-annotation-id": annotation.id }
        }).range(from, to)
      ];
    })
    .sort((left, right) => left.from - right.from || left.to - right.to);
  return Decoration.set(ranges, true);
}

