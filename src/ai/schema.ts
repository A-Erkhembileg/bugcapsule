import { z } from 'zod';
import { sanitizeText } from '../core/privacy';
import { AI_PROMPT_VERSION } from './prompt';

z.config({ jitless: true });

export const aiModelSchema = z.enum([
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
]);
export type AiModel = z.infer<typeof aiModelSchema>;

const eventId = z.string().min(1).max(80);
const eventIds = z.array(eventId).max(200);
const step = z.string().min(1).max(500);

export const aiObservationSchema = z
  .object({
    description: z.string().min(1).max(1_000),
    eventIds: eventIds.min(1),
  })
  .strict();

export const aiHypothesisSchema = z
  .object({
    hypothesisId: z.string().min(1).max(40),
    title: z.string().min(1).max(200),
    explanation: z.string().min(1).max(1_600),
    supportingEventIds: eventIds.min(1),
    contradictingEventIds: eventIds,
    suggestedFix: z.string().min(1).max(1_600),
    verificationSteps: z.array(step).min(1).max(10),
    uncertaintyNotes: z.string().min(1).max(1_000),
  })
  .strict();

/** Provider-owned text only. Provenance and metrics are assigned by the caller. */
export const aiContentSchema = z
  .object({
    summary: z.string().min(1).max(1_200),
    observations: z.array(aiObservationSchema).max(20),
    hypotheses: z.array(aiHypothesisSchema).max(5),
    recommendedDebuggingSteps: z.array(step).min(1).max(15),
    missingEvidence: z.array(step).max(12),
    limitations: z.array(step).min(1).max(12),
  })
  .strict();
export type AiContent = z.infer<typeof aiContentSchema>;

export const tokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().max(1_000_000_000).optional(),
    outputTokens: z.number().int().nonnegative().max(1_000_000_000).optional(),
    totalTokens: z.number().int().nonnegative().max(1_000_000_000).optional(),
  })
  .strict();

export const aiDiagnosticSchema = aiContentSchema
  .extend({
    schemaVersion: z.literal('1.0.0'),
    analysisId: z.string().min(1).max(80),
    reportId: z.string().min(1).max(80),
    provider: z.literal('google-gemini'),
    model: aiModelSchema,
    promptVersion: z.literal(AI_PROMPT_VERSION),
    generatedAt: z.string().datetime(),
    evidenceIds: eventIds,
    durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
    tokenUsage: tokenUsageSchema.optional(),
  })
  .strict();
export type AiDiagnosticResult = z.infer<typeof aiDiagnosticSchema>;

export const AI_RESPONSE_JSON_SCHEMA = z.toJSONSchema(aiContentSchema, {
  target: 'draft-7',
});
export const AI_DIAGNOSTIC_JSON_SCHEMA = AI_RESPONSE_JSON_SCHEMA;

/** Runtime schema validity alone cannot establish that an event was supplied. */
export function validateDiagnosticEvidence(
  content: unknown,
  allowedIds: readonly string[],
): AiContent {
  const parsed = aiContentSchema.parse(content);
  const allowed = new Set(allowedIds);
  const referenced = parsed.observations
    .flatMap((observation) => observation.eventIds)
    .concat(
      parsed.hypotheses.flatMap((hypothesis) => [
        ...hypothesis.supportingEventIds,
        ...hypothesis.contradictingEventIds,
      ]),
    );
  if (referenced.some((id) => !allowed.has(id))) {
    throw new Error(
      'AI diagnostic contains an event reference that was not supplied.',
    );
  }
  if (
    new Set(parsed.hypotheses.map((hypothesis) => hypothesis.hypothesisId))
      .size !== parsed.hypotheses.length
  ) {
    throw new Error('AI diagnostic contains duplicate hypothesis identifiers.');
  }
  for (const hypothesis of parsed.hypotheses) {
    if (
      hypothesis.supportingEventIds.some((id) =>
        hypothesis.contradictingEventIds.includes(id),
      )
    ) {
      throw new Error(
        'An event cannot both support and contradict the same hypothesis.',
      );
    }
  }
  return parsed;
}

/** Sanitize generated prose without modifying IDs or locally assigned metadata. */
export function sanitizeDiagnosticContent(content: AiContent): AiContent {
  const clean = (value: string, limit: number) => sanitizeText(value, limit);
  return aiContentSchema.parse({
    summary: clean(content.summary, 1_200),
    observations: content.observations.map((observation) => ({
      ...observation,
      description: clean(observation.description, 1_000),
    })),
    hypotheses: content.hypotheses.map((hypothesis) => ({
      ...hypothesis,
      title: clean(hypothesis.title, 200),
      explanation: clean(hypothesis.explanation, 1_600),
      suggestedFix: clean(hypothesis.suggestedFix, 1_600),
      verificationSteps: hypothesis.verificationSteps.map((value) =>
        clean(value, 500),
      ),
      uncertaintyNotes: clean(hypothesis.uncertaintyNotes, 1_000),
    })),
    recommendedDebuggingSteps: content.recommendedDebuggingSteps.map((value) =>
      clean(value, 500),
    ),
    missingEvidence: content.missingEvidence.map((value) => clean(value, 500)),
    limitations: content.limitations.map((value) => clean(value, 500)),
  });
}

export interface DiagnosticMetadata {
  reportId: string;
  model: AiModel;
  evidenceIds: string[];
  analysisId?: string;
  generatedAt?: string;
  durationMs?: number;
  tokenUsage?: z.infer<typeof tokenUsageSchema>;
}

export function finalizeDiagnostic(
  content: unknown,
  metadata: DiagnosticMetadata,
): AiDiagnosticResult {
  const parsed = sanitizeDiagnosticContent(
    validateDiagnosticEvidence(content, metadata.evidenceIds),
  );
  return aiDiagnosticSchema.parse({
    ...parsed,
    schemaVersion: '1.0.0',
    analysisId: metadata.analysisId ?? crypto.randomUUID(),
    reportId: metadata.reportId,
    provider: 'google-gemini',
    model: metadata.model,
    promptVersion: AI_PROMPT_VERSION,
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    evidenceIds: [...new Set(metadata.evidenceIds)],
    ...(metadata.durationMs !== undefined
      ? { durationMs: metadata.durationMs }
      : {}),
    ...(metadata.tokenUsage ? { tokenUsage: metadata.tokenUsage } : {}),
  });
}

export function validateDiagnosticForReport(
  diagnostic: unknown,
  reportId: string,
  reportEventIds: readonly string[],
): AiDiagnosticResult {
  const parsed = aiDiagnosticSchema.parse(diagnostic);
  if (parsed.reportId !== reportId)
    throw new Error('AI diagnostic refers to a different report.');
  const actual = new Set(reportEventIds);
  if (parsed.evidenceIds.some((id) => !actual.has(id)))
    throw new Error('AI diagnostic evidence is absent from this report.');
  validateDiagnosticEvidence(
    {
      summary: parsed.summary,
      observations: parsed.observations,
      hypotheses: parsed.hypotheses,
      recommendedDebuggingSteps: parsed.recommendedDebuggingSteps,
      missingEvidence: parsed.missingEvidence,
      limitations: parsed.limitations,
    },
    parsed.evidenceIds,
  );
  return parsed;
}
