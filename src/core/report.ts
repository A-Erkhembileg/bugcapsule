import { z } from 'zod';
import {
  sanitizeDiagnosticContent,
  validateDiagnosticForReport,
} from '../ai/schema';
import type {
  CaptureEvent,
  CaptureState,
  Environment,
  Report,
} from '../shared/types';
import { MAX_STACK_LENGTH, sanitizeText, sanitizeUrl } from './privacy';
import { eventKindSchema, eventSchema, reportSchema } from './schema';

export function createEmptyState(): CaptureState {
  return {
    report: null,
    active: false,
    tabId: null,
    startedAt: null,
    timelineEnabled: false,
    notice: null,
    droppedEvents: 0,
  };
}

export function createReport(
  environment: Environment,
  now = Date.now(),
  id: string = crypto.randomUUID(),
): Report {
  return reportSchema.parse({
    schemaVersion: '1.2.0',
    id,
    createdAt: new Date(now).toISOString(),
    title: '',
    description: '',
    expectedBehavior: '',
    actualBehavior: '',
    steps: [],
    events: [],
    privacyReviewed: false,
    environment: {
      url: sanitizeUrl(environment.url),
      browser: sanitizeText(environment.browser, 500),
      viewport: environment.viewport,
      language: sanitizeText(environment.language, 80),
    },
  });
}

const rawEventSchema = z
  .object({
    kind: eventKindSchema,
    message: z.string().max(32_000),
    source: z.string().max(8_192).optional(),
    line: z.number().int().nonnegative().max(100_000_000).optional(),
    column: z.number().int().nonnegative().max(100_000_000).optional(),
    stack: z.string().max(32_000).optional(),
  })
  .strict();

export function normalizeEvent(
  raw: unknown,
  startedAt: number,
  now = Date.now(),
): CaptureEvent | null {
  const parsed = rawEventSchema.safeParse(raw);
  if (!parsed.success || !Number.isFinite(startedAt) || !Number.isFinite(now))
    return null;
  const offsetMs = Math.max(0, Math.trunc(now - startedAt));
  if (offsetMs > 86_400_000 || now < 0 || now > 8_640_000_000_000_000)
    return null;
  const input = parsed.data;
  const event = {
    id: crypto.randomUUID(),
    kind: input.kind,
    timestamp: new Date(now).toISOString(),
    offsetMs,
    message: sanitizeText(input.message),
    ...(input.source !== undefined
      ? { source: sanitizeUrl(input.source) }
      : {}),
    ...(input.line !== undefined ? { line: input.line } : {}),
    ...(input.column !== undefined ? { column: input.column } : {}),
    ...(input.stack !== undefined
      ? { stack: sanitizeText(input.stack, MAX_STACK_LENGTH) }
      : {}),
  };
  const result = eventSchema.safeParse(event);
  return result.success ? result.data : null;
}

/** Reapply known patterns at export after user edits. Does not mutate the draft. */
export function sanitizedReport(input: Report): Report {
  const report = reportSchema.parse(input);
  const analysis = report.aiDiagnostic;
  const cleanAnalysis =
    typeof analysis === 'string'
      ? sanitizeText(analysis, 12_000)
      : analysis
        ? {
            ...validateDiagnosticForReport(
              analysis,
              report.id,
              report.events.map((event) => event.id),
            ),
            ...sanitizeDiagnosticContent(analysis),
          }
        : undefined;
  return {
    ...report,
    schemaVersion:
      typeof cleanAnalysis === 'object'
        ? '1.2.0'
        : cleanAnalysis !== undefined && report.schemaVersion === '1.0.0'
          ? '1.1.0'
          : report.schemaVersion,
    ...(cleanAnalysis !== undefined ? { aiDiagnostic: cleanAnalysis } : {}),
    title: sanitizeText(report.title, 200),
    description: sanitizeText(report.description, 10_000),
    expectedBehavior: sanitizeText(report.expectedBehavior, 5_000),
    actualBehavior: sanitizeText(report.actualBehavior, 5_000),
    steps: report.steps.map((step) => sanitizeText(step)),
    environment: {
      ...report.environment,
      url: sanitizeUrl(report.environment.url),
      browser: sanitizeText(report.environment.browser, 500),
      language: sanitizeText(report.environment.language, 80),
    },
    events: report.events.map((event) => ({
      ...event,
      message: sanitizeText(event.message),
      ...(event.source !== undefined
        ? { source: sanitizeUrl(event.source) }
        : {}),
      ...(event.stack !== undefined
        ? { stack: sanitizeText(event.stack, MAX_STACK_LENGTH) }
        : {}),
    })),
  };
}
