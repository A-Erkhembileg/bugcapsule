import { z } from 'zod';
import { aiDiagnosticSchema, validateDiagnosticForReport } from '../ai/schema';
import {
  MAX_EVENTS,
  MAX_MESSAGE_LENGTH,
  MAX_SCREENSHOT_LENGTH,
  MAX_STACK_LENGTH,
} from './privacy';

// Use Zod's interpreter in both extension contexts, including under MV3's strict CSP.
z.config({ jitless: true });

export const eventKindSchema = z.enum([
  'console-error',
  'error',
  'unhandled-rejection',
  'click',
  'navigation',
]);

export const eventSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: eventKindSchema,
    timestamp: z.string().datetime(),
    offsetMs: z.number().int().nonnegative().max(86_400_000),
    message: z.string().max(MAX_MESSAGE_LENGTH),
    source: z.string().max(2_048).optional(),
    line: z.number().int().nonnegative().max(100_000_000).optional(),
    column: z.number().int().nonnegative().max(100_000_000).optional(),
    stack: z.string().max(MAX_STACK_LENGTH).optional(),
  })
  .strict();

export const environmentSchema = z
  .object({
    url: z.string().max(2_048),
    browser: z.string().max(500),
    viewport: z
      .object({
        width: z.number().int().nonnegative().max(100_000),
        height: z.number().int().nonnegative().max(100_000),
        devicePixelRatio: z.number().positive().max(20),
      })
      .strict(),
    language: z.string().max(80),
  })
  .strict();

export const screenshotSchema = z
  .object({
    dataUrl: z
      .string()
      .max(MAX_SCREENSHOT_LENGTH)
      .regex(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/),
    width: z.number().int().positive().max(16_384),
    height: z.number().int().positive().max(16_384),
    redacted: z.boolean(),
  })
  .strict();

const reportFields = {
  schemaVersion: z.enum(['1.0.0', '1.1.0', '1.2.0']),
  id: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
  title: z.string().max(200),
  description: z.string().max(10_000),
  expectedBehavior: z.string().max(5_000),
  actualBehavior: z.string().max(5_000),
  steps: z.array(z.string().max(2_000)).max(50),
  environment: environmentSchema,
  events: z.array(eventSchema).max(MAX_EVENTS),
  privacyReviewed: z.boolean(),
  aiDiagnostic: z
    .union([z.string().max(12_000), aiDiagnosticSchema])
    .optional(),
};

function validateReportEvidence(
  report: { id: string; events: { id: string }[]; aiDiagnostic?: unknown },
  context: z.RefinementCtx,
) {
  const ids = report.events.map((event) => event.id);
  if (new Set(ids).size !== ids.length)
    context.addIssue({
      code: 'custom',
      message: 'Captured event identifiers must be unique.',
    });
  if (
    report.aiDiagnostic !== undefined &&
    typeof report.aiDiagnostic !== 'string'
  ) {
    try {
      validateDiagnosticForReport(report.aiDiagnostic, report.id, ids);
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['aiDiagnostic'],
        message:
          'Diagnostic identity or evidence references do not match this report.',
      });
    }
  }
}

export const reportSchema = z
  .object({ ...reportFields, screenshot: screenshotSchema.optional() })
  .strict()
  .superRefine(validateReportEvidence);

const exportedScreenshotSchema = z
  .object({
    file: z.literal('screenshot.png'),
    mimeType: z.literal('image/png'),
    width: z.number().int().positive().max(16_384),
    height: z.number().int().positive().max(16_384),
    redacted: z.boolean(),
  })
  .strict()
  .optional();

const currentExportSchema = z
  .object({
    ...reportFields,
    schemaVersion: z.literal('1.1.0'),
    aiDiagnostic: z.string().max(12_000).optional(),
    screenshot: exportedScreenshotSchema,
  })
  .strict();

const structuredExportSchema = z
  .object({
    ...reportFields,
    schemaVersion: z.literal('1.2.0'),
    screenshot: exportedScreenshotSchema,
  })
  .strict();

const legacyExportSchema = z
  .object({
    ...reportFields,
    schemaVersion: z.literal('1.0.0'),
    aiDiagnostic: z.never().optional(),
    screenshot: exportedScreenshotSchema,
  })
  .strict();

export const exportedReportSchema = z
  .discriminatedUnion('schemaVersion', [
    legacyExportSchema,
    currentExportSchema,
    structuredExportSchema,
  ])
  .superRefine(validateReportEvidence);

export const stateSchema = z
  .object({
    report: reportSchema.nullable(),
    active: z.boolean(),
    tabId: z.number().int().nonnegative().nullable(),
    startedAt: z.number().int().nonnegative().nullable(),
    timelineEnabled: z.boolean(),
    notice: z.string().max(1_000).nullable(),
    droppedEvents: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.active &&
      (!state.report || state.tabId === null || state.startedAt === null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Active capture requires a report, target tab, and start time.',
      });
    }
  });
