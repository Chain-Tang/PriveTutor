import { useMemo, useState } from "react";
import type { Annotation } from "@annotation-tutor/domain";
import type { createTranslator } from "./i18n.js";

type DashboardProps = {
  annotations: Annotation[];
  t: ReturnType<typeof createTranslator>;
  onOpen: (annotation: Annotation) => void;
  onEdit: (annotation: Annotation) => void;
  onReview: (annotation: Annotation) => void;
  onFollowUp: (annotation: Annotation) => void;
  onDeleteReview: (annotation: Annotation) => void;
  onDelete: (annotation: Annotation) => void;
};

export function Dashboard({
  annotations,
  t,
  onOpen,
  onEdit,
  onReview,
  onFollowUp,
  onDeleteReview,
  onDelete
}: DashboardProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [document, setDocument] = useState("");
  const [concept, setConcept] = useState("");
  const [reviewState, setReviewState] = useState("");
  const [createdWithinDays, setCreatedWithinDays] = useState("");
  const documents = useMemo(
    () => [...new Set(annotations.map((annotation) => annotation.filePath))].sort(),
    [annotations]
  );
  const concepts = useMemo(
    () =>
      [...new Set(annotations.flatMap((annotation) => annotation.concepts))].sort(),
    [annotations]
  );
  const filtered = useMemo(
    () =>
      annotations.filter((annotation) => {
        const haystack = [
          annotation.anchor.selectedText,
          annotation.userNote.content,
          annotation.filePath,
          annotation.review?.summary ?? "",
          ...annotation.tags,
          ...annotation.concepts
        ]
          .join(" ")
          .toLocaleLowerCase();
        return (
          (!query || haystack.includes(query.toLocaleLowerCase())) &&
          (!status || annotation.status === status) &&
          (!document || annotation.filePath === document) &&
          (!concept || annotation.concepts.includes(concept)) &&
          (!reviewState ||
            (reviewState === "reviewed"
              ? annotation.review !== undefined
              : annotation.review === undefined)) &&
          (!createdWithinDays ||
            Date.parse(annotation.createdAt) >=
              Date.now() - Number(createdWithinDays) * 86_400_000)
        );
      }),
    [
      annotations,
      concept,
      createdWithinDays,
      document,
      query,
      reviewState,
      status
    ]
  );

  return (
    <div className="annotation-tutor-root">
      <h2>{t("dashboard.title")}</h2>
      <div className="annotation-tutor-toolbar">
        <input
          aria-label={t("dashboard.search")}
          placeholder={t("dashboard.search")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <select value={status} onChange={(event) => setStatus(event.currentTarget.value)}>
          <option value="">{t("dashboard.allStatuses")}</option>
          {["saved", "review_requested", "reviewed", "archived", "orphaned"].map(
            (value) => (
              <option key={value} value={value}>
                {value}
              </option>
            )
          )}
        </select>
        <select
          value={document}
          onChange={(event) => setDocument(event.currentTarget.value)}
        >
          <option value="">{t("dashboard.allDocuments")}</option>
          {documents.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          value={concept}
          onChange={(event) => setConcept(event.currentTarget.value)}
        >
          <option value="">{t("dashboard.allConcepts")}</option>
          {concepts.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          value={reviewState}
          onChange={(event) => setReviewState(event.currentTarget.value)}
        >
          <option value="">{t("dashboard.allReviews")}</option>
          <option value="reviewed">{t("dashboard.reviewed")}</option>
          <option value="unreviewed">{t("dashboard.unreviewed")}</option>
        </select>
        <select
          value={createdWithinDays}
          onChange={(event) => setCreatedWithinDays(event.currentTarget.value)}
        >
          <option value="">{t("dashboard.allTimes")}</option>
          <option value="7">{t("dashboard.last7Days")}</option>
          <option value="30">{t("dashboard.last30Days")}</option>
        </select>
      </div>
      <div className="annotation-tutor-list">
        {filtered.length === 0 ? (
          <p className="annotation-tutor-muted">{t("dashboard.empty")}</p>
        ) : (
          filtered.map((annotation) => (
            <article className="annotation-tutor-card" key={annotation.id}>
              <button className="clickable-icon" onClick={() => onOpen(annotation)}>
                <strong>{annotation.anchor.selectedText || annotation.filePath}</strong>
              </button>
              <p>{annotation.userNote.content}</p>
              {annotation.review ? (
                <p>
                  <strong>{t("review.title")}:</strong> {annotation.review.summary}
                </p>
              ) : null}
              <small className="annotation-tutor-muted">
                {annotation.filePath} · {annotation.status}
              </small>
              <div className="annotation-tutor-actions">
                <button onClick={() => onOpen(annotation)}>{t("action.open")}</button>
                <button onClick={() => onEdit(annotation)}>{t("action.edit")}</button>
                {!annotation.review ? (
                  <button onClick={() => onReview(annotation)}>
                    {t("action.review")}
                  </button>
                ) : null}
                {annotation.review && !annotation.review.followUp ? (
                  <button onClick={() => onFollowUp(annotation)}>
                    {t("review.followUp")}
                  </button>
                ) : null}
                {annotation.review ? (
                  <button onClick={() => onDeleteReview(annotation)}>
                    {t("action.deleteReview")}
                  </button>
                ) : null}
                <button className="mod-warning" onClick={() => onDelete(annotation)}>
                  {t("action.delete")}
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
