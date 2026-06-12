import {
  AnnotationTutorError,
  agentReviewSchema,
  type AgentReview
} from "@annotation-tutor/domain";

export const reviewOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "correctness",
    "summary",
    "strengths",
    "weaknesses",
    "missingConcepts",
    "suggestedRevision",
    "socraticQuestion"
  ],
  properties: {
    correctness: {
      type: "string",
      enum: ["correct", "partially_correct", "incorrect", "uncertain"]
    },
    summary: { type: "string", minLength: 1 },
    strengths: { type: "array", items: { type: "string" } },
    weaknesses: { type: "array", items: { type: "string" } },
    missingConcepts: { type: "array", items: { type: "string" } },
    suggestedRevision: { type: "string" },
    socraticQuestion: { type: "string" }
  }
} as const;

export function buildReviewPrompt(annotationId: string): string {
  return `Review the learner's understanding in Annotation Tutor.

Annotation ID: ${annotationId}

Required workflow:
1. Call get_annotation_detail with this annotation ID.
2. Call get_document_profile and follow the returned strategy.
3. Use get_document_outline, read_document_chunk, and search_document as required.
4. Evaluate the learner's note against the selected source and its document context.
5. Separate statements supported by the document under "Document evidence" from general model knowledge under "Background knowledge".
6. Return only JSON matching the supplied schema. Do not include Markdown fences.

Do not inspect arbitrary files or paths. Do not modify files.

Output JSON schema:
${JSON.stringify(reviewOutputJsonSchema)}`;
}

export function parseAgentReview(
  text: string,
  provider: "opencode" | "codex",
  createdAt = new Date().toISOString()
): AgentReview {
  const value = extractJson(text);
  try {
    return agentReviewSchema.parse({
      ...(value as Record<string, unknown>),
      provider,
      createdAt
    });
  } catch (error) {
    throw new AnnotationTutorError(
      "INVALID_INPUT",
      `Agent returned an invalid structured review: ${
        error instanceof Error ? error.message : String(error)
      }`,
      422
    );
  }
}

export function parseFollowUpAnswer(text: string): string {
  const value = extractJson(text);
  if (
    typeof value !== "object" ||
    value === null ||
    !("answer" in value) ||
    typeof (value as { answer: unknown }).answer !== "string" ||
    !(value as { answer: string }).answer.trim()
  ) {
    throw new AnnotationTutorError(
      "INVALID_INPUT",
      "Agent returned an invalid follow-up answer",
      422
    );
  }
  return (value as { answer: string }).answer.trim();
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
  if (!candidate || !candidate.startsWith("{") || !candidate.endsWith("}")) {
    throw new AnnotationTutorError(
      "INVALID_INPUT",
      "Agent response does not contain valid JSON",
      422
    );
  }
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    throw new AnnotationTutorError(
      "INVALID_INPUT",
      "Agent response does not contain valid JSON",
      422
    );
  }
}
