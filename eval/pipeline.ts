import { sanitizedReport } from '../src/core';
import {
  AI_INPUT_LIMIT,
  buildDiagnosticPayload,
  evidenceIdsFromPayload,
  parseDiagnosticPayload,
} from '../src/ai/payload';
import {
  finalizeDiagnostic,
  type AiDiagnosticResult,
  type AiModel,
} from '../src/ai/schema';
import type { Report } from '../src/shared/types';

export type EvaluationMethod = 'A' | 'B';

/** Baseline preserves genuine IDs and redaction, but supplies only individual raw errors. */
export function buildBaselinePayload(input: Report): string {
  const report = sanitizedReport(input);
  const errors = report.events
    .filter((event) => !['click', 'navigation'].includes(event.kind))
    .map((event) => ({ ...event, eventIds: [event.id], occurrences: 1 }));
  let payload = JSON.stringify(
    { reportId: report.id, errors, timeline: [] },
    null,
    2,
  );
  while (payload.length > AI_INPUT_LIMIT && errors.length > 1) {
    errors.pop();
    payload = JSON.stringify(
      { reportId: report.id, errors, timeline: [] },
      null,
      2,
    );
  }
  parseDiagnosticPayload(payload);
  return payload;
}

export function evaluationPayload(
  report: Report,
  method: EvaluationMethod,
): string {
  return method === 'A'
    ? buildBaselinePayload(report)
    : buildDiagnosticPayload(report);
}

/** A deterministic protocol adapter, deliberately unable to solve the oracle tasks. */
export function mockDiagnostic(
  payload: string,
  model: AiModel,
): AiDiagnosticResult {
  const parsed = parseDiagnosticPayload(payload);
  const first = parsed.errors[0];
  return finalizeDiagnostic(
    {
      summary:
        'Synthetic mock adapter output. No Google request or root-cause analysis was performed.',
      observations: first
        ? [
            {
              description: `The capture contains a ${first.kind} event.`,
              eventIds: [first.id],
            },
          ]
        : [],
      hypotheses: [],
      recommendedDebuggingSteps: [
        'Inspect the captured events and relevant source code before drawing a conclusion.',
      ],
      missingEvidence: [
        'A real diagnostic model response is required for quality evaluation.',
      ],
      limitations: [
        'This is a deterministic mock for protocol and evidence-reference validation, not evidence of model quality.',
      ],
    },
    {
      reportId: parsed.reportId,
      model,
      evidenceIds: evidenceIdsFromPayload(payload),
      analysisId: 'mock-analysis',
      generatedAt: '2000-01-01T00:00:00.000Z',
    },
  );
}

export function referenceMetrics(
  diagnostic: AiDiagnosticResult,
  allowedIds: readonly string[],
) {
  const references = diagnostic.observations
    .flatMap((item) => item.eventIds)
    .concat(
      diagnostic.hypotheses.flatMap((item) => [
        ...item.supportingEventIds,
        ...item.contradictingEventIds,
      ]),
    );
  const allowed = new Set(allowedIds);
  const genuine = references.filter((id) => allowed.has(id)).length;
  return {
    references: references.length,
    genuineReferences: genuine,
    genuineReferenceFraction: references.length
      ? genuine / references.length
      : null,
  };
}

export function estimateCost(
  usage: AiDiagnosticResult['tokenUsage'],
  prices?: { inputPerMillion: number; outputPerMillion: number },
): number | null {
  if (
    !prices ||
    usage?.inputTokens === undefined ||
    usage.outputTokens === undefined
  )
    return null;
  if (
    ![prices.inputPerMillion, prices.outputPerMillion].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    throw new Error('Prices must be nonnegative dollars per million tokens.');
  return (
    (usage.inputTokens * prices.inputPerMillion +
      usage.outputTokens * prices.outputPerMillion) /
    1_000_000
  );
}
