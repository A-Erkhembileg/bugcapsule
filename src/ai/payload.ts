import { z } from 'zod';
import { sanitizedReport } from '../core/report';
import { sanitizeText, sanitizeUrl } from '../core/privacy';
import type { Report } from '../shared/types';

export const AI_INPUT_LIMIT = 24_000;
const id = z.string().min(1).max(80);
const evidenceSchema = z
  .object({
    id,
    eventIds: z.array(id).min(1).max(200),
    kind: z.enum([
      'console-error',
      'error',
      'unhandled-rejection',
      'click',
      'navigation',
    ]),
    timestamp: z.string().datetime(),
    offsetMs: z.number().int().nonnegative().max(86_400_000),
    message: z.string().max(2_000),
    source: z.string().max(2_048).optional(),
    line: z.number().int().nonnegative().optional(),
    column: z.number().int().nonnegative().optional(),
    stack: z.string().max(4_000).optional(),
    occurrences: z.number().int().positive().max(200).optional(),
  })
  .strict();
export type AiPayloadEvidence = z.infer<typeof evidenceSchema>;

/** Baseline evaluation inputs may omit report prose while retaining genuine evidence. */
export const diagnosticPayloadSchema = z
  .object({
    reportId: id,
    schemaVersion: z.enum(['1.0.0', '1.1.0', '1.2.0']).optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(2_000).optional(),
    expectedBehavior: z.string().max(1_000).optional(),
    actualBehavior: z.string().max(1_000).optional(),
    steps: z.array(z.string().max(300)).max(20).optional(),
    environment: z
      .object({
        url: z.string().max(2_048),
        browser: z.string().max(500),
        viewport: z
          .object({
            width: z.number(),
            height: z.number(),
            devicePixelRatio: z.number(),
          })
          .strict(),
        language: z.string().max(80),
      })
      .strict()
      .optional(),
    errors: z.array(evidenceSchema).max(200),
    timeline: z.array(evidenceSchema).max(200),
    scope: z.string().max(1_000).optional(),
  })
  .strict()
  .superRefine((payload, context) => {
    const records = [...payload.errors, ...payload.timeline];
    const seen = new Set<string>();
    for (const event of records) {
      if (!event.eventIds.includes(event.id))
        context.addIssue({
          code: 'custom',
          message: 'Primary event ID must appear among its evidence aliases.',
        });
      for (const alias of event.eventIds) {
        if (seen.has(alias))
          context.addIssue({
            code: 'custom',
            message: 'Evidence identifiers must be unique across the payload.',
          });
        seen.add(alias);
      }
    }
  });
export type AiDiagnosticPayload = z.infer<typeof diagnosticPayloadSchema>;

export function parseDiagnosticPayload(payload: string): AiDiagnosticPayload {
  if (!payload || payload.length > AI_INPUT_LIMIT)
    throw new Error('Invalid or oversized diagnostic payload.');
  return diagnosticPayloadSchema.parse(JSON.parse(payload));
}

export function evidenceIdsFromPayload(payload: string): string[] {
  const parsed = parseDiagnosticPayload(payload);
  return [...parsed.errors, ...parsed.timeline].flatMap(
    (event) => event.eventIds,
  );
}

/** The allowlist prevents screenshots, credentials and earlier AI output entering the request. */
export function buildDiagnosticPayload(input: Report): string {
  const report = sanitizedReport(input);
  const errors = new Map<string, AiPayloadEvidence>();
  const timeline: AiPayloadEvidence[] = [];
  for (const event of report.events) {
    const base = {
      id: event.id,
      eventIds: [event.id],
      kind: event.kind,
      timestamp: event.timestamp,
      offsetMs: event.offsetMs,
      occurrences: 1,
    };
    if (event.kind === 'click' || event.kind === 'navigation') {
      const message =
        event.kind === 'navigation'
          ? 'Same-document navigation'
          : [
                'Clicked button',
                'Clicked link',
                'Clicked disclosure',
                'Clicked page element',
              ].includes(event.message)
            ? event.message
            : 'Clicked page element';
      const previous = timeline.at(-1);
      if (previous?.kind === event.kind && previous.message === message) {
        previous.occurrences = (previous.occurrences ?? 1) + 1;
        previous.eventIds.push(event.id);
      } else if (timeline.length < 12) timeline.push({ ...base, message });
      continue;
    }
    const key = JSON.stringify([
      event.kind,
      event.message,
      event.source,
      event.line,
      event.column,
      event.stack,
    ]);
    const previous = errors.get(key);
    if (previous) {
      previous.occurrences = (previous.occurrences ?? 1) + 1;
      previous.eventIds.push(event.id);
      continue;
    }
    if (errors.size >= 12) continue;
    errors.set(key, {
      ...base,
      message: sanitizeText(event.message, 1_000),
      ...(event.source
        ? { source: sanitizeUrl(event.source).slice(0, 300) }
        : {}),
      ...(event.line !== undefined ? { line: event.line } : {}),
      ...(event.column !== undefined ? { column: event.column } : {}),
      ...(event.stack ? { stack: sanitizeText(event.stack, 1_400) } : {}),
    });
  }
  const payload = {
    reportId: report.id,
    schemaVersion: report.schemaVersion,
    title: report.title,
    description: report.description.slice(0, 2_000),
    expectedBehavior: report.expectedBehavior.slice(0, 1_000),
    actualBehavior: report.actualBehavior.slice(0, 1_000),
    steps: report.steps.slice(0, 20).map((step) => step.slice(0, 300)),
    environment: report.environment,
    errors: [...errors.values()],
    timeline,
    scope:
      'Main document only. Events begin after activation. Duplicate errors/actions are grouped and retain their genuine eventIds aliases; the timestamp is the first occurrence. Fields and events may be shortened or omitted for the size budget. No screenshot, API key or earlier AI output is included.',
  };
  let encoded = JSON.stringify(payload, null, 2);
  while (encoded.length > AI_INPUT_LIMIT && payload.steps.length) {
    payload.steps.pop();
    encoded = JSON.stringify(payload, null, 2);
  }
  while (encoded.length > AI_INPUT_LIMIT && payload.timeline.length) {
    payload.timeline.pop();
    encoded = JSON.stringify(payload, null, 2);
  }
  while (encoded.length > AI_INPUT_LIMIT && payload.errors.length > 1) {
    payload.errors.pop();
    encoded = JSON.stringify(payload, null, 2);
  }
  if (encoded.length > AI_INPUT_LIMIT)
    throw new Error(
      'The diagnostic payload is too large. Shorten the report before trying again.',
    );
  parseDiagnosticPayload(encoded);
  return encoded;
}
