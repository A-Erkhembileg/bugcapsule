import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { defectFixtures } from './fixtures';
import type { EvaluationRun } from './results';
import { parseEvaluationRun } from './validation';

const score = z.number().int().min(0).max(2);
export const completedReviewSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    runId: z.string(),
    items: z.array(
      z
        .object({
          reviewId: z.string(),
          reviewer: z.string().trim().min(1),
          reviewedAt: z.string().datetime(),
          causeIdentification: score,
          actionability: score,
          unsupportedClaims: score,
          notes: z.string().trim().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export function makeReview(run: EvaluationRun) {
  run = parseEvaluationRun(run);
  const mapping: {
    reviewId: string;
    recordId: string;
    fixtureId: string;
    method: 'A' | 'B';
  }[] = [];
  // Randomize presentation without changing model call order or the saved raw results.
  const randomized = run.records
    .map((record) => ({ record, key: randomUUID() }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const items = randomized.map(({ record }) => {
    const reviewId = randomUUID();
    mapping.push({
      reviewId,
      recordId: record.recordId,
      fixtureId: record.fixtureId,
      method: record.method,
    });
    const fixture = defectFixtures.find((item) => item.id === record.fixtureId);
    const capture = run.captures.find(
      (item) => item.fixtureId === record.fixtureId,
    );
    return {
      reviewId,
      fixtureId: record.fixtureId,
      oracle: fixture
        ? {
            symptom: fixture.symptom,
            knownCause: fixture.knownCause,
            acceptableExplanation: fixture.acceptableExplanation,
            relevantVerificationSteps: fixture.relevantVerificationSteps,
          }
        : null,
      evidence: capture?.report ?? null,
      output: record.diagnostic,
      error: record.error,
      reviewer: '',
      reviewedAt: null,
      causeIdentification: null,
      actionability: null,
      unsupportedClaims: null,
      notes: '',
    };
  });
  return {
    packet: {
      schemaVersion: '1.0.0',
      runId: run.runId,
      warning:
        run.adapter === 'mock'
          ? 'MOCK RUN. Protocol rehearsal only. Do not grade or publish model-quality findings.'
          : 'Method identities are withheld. Inspect source oracle and full captured evidence. Do not use an LLM as conclusive grader.',
      items,
    },
    template: {
      schemaVersion: '1.0.0',
      runId: run.runId,
      items: items.map(({ reviewId }) => ({
        reviewId,
        reviewer: '',
        reviewedAt: null,
        causeIdentification: null,
        actionability: null,
        unsupportedClaims: null,
        notes: '',
      })),
    },
    mapping: { schemaVersion: '1.0.0', runId: run.runId, items: mapping },
  };
}

export function gradeReview(
  run: EvaluationRun,
  reviewInput: unknown,
  mappingInput: unknown,
) {
  run = parseEvaluationRun(run);
  if (run.adapter === 'mock')
    throw new Error(
      'Mock protocol runs cannot produce model-quality scores. Run an explicitly authorized live evaluation first.',
    );
  const review = completedReviewSchema.parse(reviewInput);
  const mapping = z
    .object({
      schemaVersion: z.literal('1.0.0'),
      runId: z.string(),
      items: z.array(
        z
          .object({
            reviewId: z.string(),
            recordId: z.string(),
            fixtureId: z.string(),
            method: z.enum(['A', 'B']),
          })
          .strict(),
      ),
    })
    .strict()
    .parse(mappingInput);
  if (review.runId !== run.runId || mapping.runId !== run.runId)
    throw new Error('Review and mapping must belong to this run.');
  if (
    new Set(review.items.map((item) => item.reviewId)).size !==
    review.items.length
  )
    throw new Error('Duplicate review IDs are not allowed.');
  if (
    review.items.length !== run.records.length ||
    mapping.items.length !== run.records.length
  )
    throw new Error(
      'Complete all cases, including failures, before calculating comparative results.',
    );
  if (
    new Set(mapping.items.map((item) => item.reviewId)).size !==
      mapping.items.length ||
    new Set(mapping.items.map((item) => item.recordId)).size !==
      mapping.items.length
  ) {
    throw new Error(
      'Each review and evaluation record must be mapped exactly once.',
    );
  }
  if (
    mapping.items.some(
      (item) =>
        !review.items.some((rating) => rating.reviewId === item.reviewId),
    )
  ) {
    throw new Error('Mapping contains an unknown review ID.');
  }
  const byMethod = (['A', 'B'] as const).map((method) => {
    const mapped = mapping.items.filter((item) => item.method === method);
    const ratings = mapped.map((item) => {
      const actual = run.records.find(
        (record) =>
          record.recordId === item.recordId &&
          record.fixtureId === item.fixtureId &&
          record.method === method,
      );
      const rating = review.items.find(
        (review) => review.reviewId === item.reviewId,
      );
      if (!actual || !rating)
        throw new Error('Review mapping has unknown or missing records.');
      if (
        actual.error !== null &&
        (rating.causeIdentification !== 0 || rating.actionability !== 0)
      ) {
        throw new Error(
          'Failed diagnostic results must receive zero cause-identification and actionability scores.',
        );
      }
      return { record: actual, rating };
    });
    const n = ratings.length;
    if (!n) throw new Error('Both methods need reviewed records.');
    const measuredLatencies = ratings
      .map((item) => item.record.metrics.apiLatencyMs)
      .filter((value): value is number => value !== null);
    return {
      method,
      reviewedCases: n,
      knownCauseIdentifiedFraction:
        ratings.filter((item) => item.rating.causeIdentification === 2).length /
        n,
      meanCauseIdentificationScore:
        ratings.reduce(
          (total, item) => total + item.rating.causeIdentification,
          0,
        ) / n,
      meanActionabilityScore:
        ratings.reduce((total, item) => total + item.rating.actionability, 0) /
        n,
      unsupportedClaimCases: ratings.filter(
        (item) => item.rating.unsupportedClaims > 0,
      ).length,
      failedResults: ratings.filter((item) => item.record.error !== null)
        .length,
      measuredLatencyCases: measuredLatencies.length,
      missingLatencyCases: n - measuredLatencies.length,
      meanAPILatencyMs: measuredLatencies.length
        ? measuredLatencies.reduce((total, value) => total + value, 0) /
          measuredLatencies.length
        : null,
      estimatedCostUSD: ratings.every(
        (item) => item.record.metrics.estimatedCostUSD !== null,
      )
        ? ratings.reduce(
            (total, item) => total + item.record.metrics.estimatedCostUSD!,
            0,
          )
        : null,
    };
  });
  return {
    schemaVersion: '1.0.0',
    runId: run.runId,
    generatedAt: new Date().toISOString(),
    source:
      'Completed human review; deterministic aggregation only. No model self-grading.',
    rubricVersion: '1.0.0',
    byMethod,
  };
}
