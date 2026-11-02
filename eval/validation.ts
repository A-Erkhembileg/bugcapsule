import { z } from 'zod';
import { reportSchema } from '../src/core/schema';
import {
  aiDiagnosticSchema,
  aiModelSchema,
  validateDiagnosticForReport,
} from '../src/ai/schema';
import {
  parseDiagnosticPayload,
  evidenceIdsFromPayload,
} from '../src/ai/payload';
import { defectFixtures } from './fixtures';
import type { CapturedFixture } from './capture';
import type { EvaluationRun } from './results';

const captureSchema = z
  .object({
    fixtureId: z.string(),
    report: reportSchema.nullable(),
    actualState: z.string().nullable(),
    reproductionPassed: z.boolean(),
    failures: z.array(z.string()).max(100),
  })
  .strict()
  .superRefine((capture, context) => {
    if (!defectFixtures.some((fixture) => fixture.id === capture.fixtureId)) {
      context.addIssue({
        code: 'custom',
        message: 'Unknown benchmark fixture.',
      });
    }
    if (
      capture.reproductionPassed &&
      (!capture.report || capture.failures.length)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A successful reproduction needs a valid report and no failures.',
      });
    }
    if (!capture.reproductionPassed && !capture.failures.length) {
      context.addIssue({
        code: 'custom',
        message: 'A failed reproduction must retain its failure details.',
      });
    }
  });

const capturesSchema = z
  .array(captureSchema)
  .min(1)
  .max(100)
  .superRefine((captures, context) => {
    if (
      new Set(captures.map((capture) => capture.fixtureId)).size !==
      captures.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Duplicate fixture captures are not allowed.',
      });
    }
  });

export function parseCaptures(value: unknown): CapturedFixture[] {
  return z
    .object({ schemaVersion: z.literal('1.0.0'), captures: capturesSchema })
    .strict()
    .parse(value).captures;
}

const nonnegative = z.number().finite().nonnegative();
const recordSchema = z
  .object({
    recordId: z.string().min(1),
    fixtureId: z.string(),
    method: z.enum(['A', 'B']),
    adapter: z.enum(['mock', 'gemini']),
    providerWasCalled: z.boolean(),
    payload: z.string().nullable(),
    diagnostic: aiDiagnosticSchema.nullable(),
    error: z.string().nullable(),
    rawResponses: z
      .array(
        z
          .object({
            status: z.number().int().min(100).max(599),
            body: z.string(),
            truncated: z.boolean(),
          })
          .strict(),
      )
      .max(3),
    metrics: z
      .object({
        wallTimeMs: nonnegative,
        apiLatencyMs: nonnegative.nullable(),
        inputCharacters: nonnegative,
        inputTokens: nonnegative.nullable(),
        outputTokens: nonnegative.nullable(),
        estimatedCostUSD: nonnegative.nullable(),
        references: nonnegative,
        genuineReferences: nonnegative,
        genuineReferenceFraction: z.number().min(0).max(1).nullable(),
      })
      .strict(),
  })
  .strict();

const runSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    benchmarkVersion: z.literal('1.0.0'),
    runId: z.string().min(1),
    createdAt: z.string().datetime(),
    adapter: z.enum(['mock', 'gemini']),
    model: aiModelSchema,
    promptVersion: z.string().min(1),
    conditions: z.array(z.string()),
    pricing: z
      .object({ inputPerMillion: nonnegative, outputPerMillion: nonnegative })
      .strict()
      .nullable(),
    captures: capturesSchema,
    records: z.array(recordSchema).min(2).max(200),
    summary: z
      .object({
        fixtures: nonnegative,
        reproduced: nonnegative,
        reproductionFailures: nonnegative,
        protocolValidResults: nonnegative,
        failedResults: nonnegative,
        humanQualityScoresAvailable: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((run, context) => {
    const ids = new Set(run.records.map((record) => record.recordId));
    const pairs = new Set(
      run.records.map((record) => `${record.fixtureId}:${record.method}`),
    );
    if (
      ids.size !== run.records.length ||
      pairs.size !== run.records.length ||
      run.records.length !== run.captures.length * 2
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Every fixture requires exactly one distinct A record and one B record.',
      });
    }
    for (const capture of run.captures) {
      if (
        !pairs.has(`${capture.fixtureId}:A`) ||
        !pairs.has(`${capture.fixtureId}:B`)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Evaluation methods must cover the same fixture set.',
        });
      }
    }
    for (const record of run.records) {
      if (
        record.adapter !== run.adapter ||
        (run.adapter === 'mock' &&
          (record.providerWasCalled ||
            record.metrics.apiLatencyMs !== null ||
            record.metrics.inputTokens !== null ||
            record.metrics.outputTokens !== null ||
            record.metrics.estimatedCostUSD !== null))
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Mock results cannot claim provider traffic, API latency, token usage or cost.',
        });
      }
      if ((record.diagnostic === null) === (record.error === null)) {
        context.addIssue({
          code: 'custom',
          message: 'Every record must retain either a diagnostic or a failure.',
        });
      }
      if (record.diagnostic) {
        try {
          const payload = parseDiagnosticPayload(record.payload ?? '');
          const capture = run.captures.find(
            (item) => item.fixtureId === record.fixtureId,
          );
          if (
            payload.reportId !== capture?.report?.id ||
            record.diagnostic.model !== run.model ||
            record.diagnostic.promptVersion !== run.promptVersion
          )
            throw new Error('Mismatched provenance.');
          validateDiagnosticForReport(
            record.diagnostic,
            payload.reportId,
            evidenceIdsFromPayload(record.payload!),
          );
        } catch {
          context.addIssue({
            code: 'custom',
            message:
              'Saved diagnostic does not match its payload, capture or provenance.',
          });
        }
      }
    }
    const expected = {
      fixtures: run.captures.length,
      reproduced: run.captures.filter((capture) => capture.reproductionPassed)
        .length,
      reproductionFailures: run.captures.filter(
        (capture) => !capture.reproductionPassed,
      ).length,
      protocolValidResults: run.records.filter(
        (record) => record.diagnostic !== null,
      ).length,
      failedResults: run.records.filter((record) => record.error !== null)
        .length,
    };
    if (
      Object.entries(expected).some(
        ([key, value]) => run.summary[key as keyof typeof expected] !== value,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Saved summary does not match the preserved records.',
      });
    }
  });

export function parseEvaluationRun(value: unknown): EvaluationRun {
  return runSchema.parse(value);
}
