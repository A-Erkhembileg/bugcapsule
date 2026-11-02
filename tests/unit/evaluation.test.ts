import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createReport, normalizeEvent } from '../../src/core';
import { parseDiagnosticPayload } from '../../src/ai/payload';
import { AI_PROMPT_VERSION } from '../../src/ai/prompt';
import { defectFixtures } from '../../eval/fixtures';
import {
  evaluationPayload,
  estimateCost,
  mockDiagnostic,
  referenceMetrics,
} from '../../eval/pipeline';
import { gradeReview, makeReview } from '../../eval/review';
import { parseCaptures, parseEvaluationRun } from '../../eval/validation';
import type { EvaluationRun } from '../../eval/results';
import type { CapturedFixture } from '../../eval/capture';

const NOW = Date.UTC(2026, 10, 2, 12);
function capture(fixtureId = 'BC-001'): CapturedFixture {
  const report = createReport(
    {
      url: 'https://example.test/fixture?token=synthetic-secret',
      browser: 'Synthetic Chromium',
      language: 'en',
      viewport: { width: 800, height: 600, devicePixelRatio: 1 },
    },
    NOW,
    `benchmark-${fixtureId}`,
  );
  report.title = 'Synthetic visible symptom';
  report.description = 'Synthetic reproduction context';
  const error = normalizeEvent(
    { kind: 'error', message: 'Failure token=synthetic-secret' },
    NOW,
    NOW + 25,
  )!;
  report.events = [
    { ...error, id: `${fixtureId}-E01` },
    { ...error, id: `${fixtureId}-E02`, offsetMs: 30 },
    {
      ...error,
      kind: 'click',
      message: 'Clicked button',
      id: `${fixtureId}-E03`,
      offsetMs: 5,
    },
  ];
  return {
    fixtureId,
    report,
    actualState: 'Idle',
    reproductionPassed: true,
    failures: [],
  };
}
function run(adapter: 'mock' | 'gemini' = 'mock'): EvaluationRun {
  const captures = [capture()];
  const report = captures[0]!.report!;
  return {
    schemaVersion: '1.0.0',
    benchmarkVersion: '1.0.0',
    runId: 'unit-only-run',
    createdAt: new Date(NOW).toISOString(),
    adapter,
    model: 'gemini-3.5-flash-lite',
    promptVersion: AI_PROMPT_VERSION,
    conditions: ['Synthetic unit data, not research findings.'],
    pricing: null,
    captures,
    records: (['A', 'B'] as const).map((method) => {
      const payload = evaluationPayload(report, method);
      const diagnostic = mockDiagnostic(payload, 'gemini-3.5-flash-lite');
      return {
        recordId: `BC-001-${method}`,
        fixtureId: 'BC-001',
        method,
        adapter,
        providerWasCalled: adapter === 'gemini',
        payload,
        diagnostic,
        error: null,
        rawResponses: [],
        metrics: {
          wallTimeMs: 1,
          apiLatencyMs: null,
          inputCharacters: payload.length,
          inputTokens: null,
          outputTokens: null,
          estimatedCostUSD: null,
          ...referenceMetrics(
            diagnostic,
            report.events.map((event) => event.id),
          ),
        },
      };
    }),
    summary: {
      fixtures: 1,
      reproduced: 1,
      reproductionFailures: 0,
      protocolValidResults: 2,
      failedResults: 0,
      humanQualityScoresAvailable: false,
    },
  };
}
function completedReview(evaluation: EvaluationRun) {
  const generated = makeReview(evaluation);
  return {
    ...generated,
    review: {
      ...generated.template,
      items: generated.template.items.map((item) => ({
        ...item,
        reviewer: 'Synthetic unit reviewer',
        reviewedAt: new Date(NOW).toISOString(),
        causeIdentification: 0,
        actionability: 1,
        unsupportedClaims: 0,
        notes: 'Unit-only rubric exercise.',
      })),
    },
  };
}

describe('reproducible evaluation protocol', () => {
  it('defines 25 distinct executable defects with reproducibility and human-oracle information', () => {
    expect(defectFixtures).toHaveLength(25);
    expect(new Set(defectFixtures.map((fixture) => fixture.id)).size).toBe(25);
    expect(
      new Set(defectFixtures.map((fixture) => fixture.category)).size,
    ).toBeGreaterThanOrEqual(15);
    for (const fixture of defectFixtures) {
      expect(fixture.script.length).toBeGreaterThan(20);
      expect(fixture.reproductionSteps.length).toBeGreaterThan(0);
      expect(fixture.knownCause.length).toBeGreaterThan(15);
      expect(fixture.acceptableExplanation.length).toBeGreaterThan(15);
      expect(fixture.relevantVerificationSteps.length).toBeGreaterThan(0);
      expect(
        fixture.expectedCapturedEvidence.kind ??
          fixture.expectedCapturedEvidence.state,
      ).toBeDefined();
    }
  });

  it('holds real identifiers and privacy constant while changing evidence selection between methods', () => {
    const report = capture().report!;
    const a = parseDiagnosticPayload(evaluationPayload(report, 'A'));
    const b = parseDiagnosticPayload(evaluationPayload(report, 'B'));
    expect(a.errors).toHaveLength(2);
    expect(b.errors).toHaveLength(1);
    expect(b.errors[0]!.eventIds).toEqual(['BC-001-E01', 'BC-001-E02']);
    expect(b.timeline[0]!.id).toBe('BC-001-E03');
    expect(a).not.toHaveProperty('description');
    expect(b.description).toBe(report.description);
    for (const payload of [a, b]) {
      const text = JSON.stringify(payload);
      expect(text).not.toContain('synthetic-secret');
      expect(payload.errors[0]!.timestamp).toBe(report.events[0]!.timestamp);
      expect(payload.reportId).toBe(report.id);
    }
  });

  it('never supplies oracle causes, answer text or source snippets to either method', () => {
    for (const fixture of defectFixtures) {
      const report = capture(fixture.id).report!;
      report.title = fixture.symptom;
      report.steps = fixture.reproductionSteps;
      for (const method of ['A', 'B'] as const) {
        const payload = evaluationPayload(report, method);
        expect(payload).not.toContain(fixture.knownCause);
        expect(payload).not.toContain(fixture.acceptableExplanation);
        expect(payload).not.toContain(fixture.script);
        expect(JSON.parse(payload)).not.toHaveProperty('knownCause');
      }
    }
  });

  it('makes deterministic conservative mock output without predicting the known cause', () => {
    const payload = evaluationPayload(capture().report!, 'B');
    const first = mockDiagnostic(payload, 'gemini-3.5-flash-lite');
    expect(mockDiagnostic(payload, 'gemini-3.5-flash-lite')).toEqual(first);
    expect(first.summary).toContain('No Google request');
    expect(first.hypotheses).toEqual([]);
    expect(first.tokenUsage).toBeUndefined();
    expect(first.durationMs).toBeUndefined();
  });

  it('counts invented references as counterexamples and does not invent coverage when there are no references', () => {
    const diagnostic = mockDiagnostic(
      evaluationPayload(capture().report!, 'B'),
      'gemini-3.5-flash-lite',
    );
    diagnostic.observations[0]!.eventIds.push('invented-event');
    expect(referenceMetrics(diagnostic, ['BC-001-E01'])).toEqual({
      references: 2,
      genuineReferences: 1,
      genuineReferenceFraction: 0.5,
    });
    diagnostic.observations = [];
    expect(referenceMetrics(diagnostic, [])).toEqual({
      references: 0,
      genuineReferences: 0,
      genuineReferenceFraction: null,
    });
  });

  it('requires actual usage and explicit prices for cost estimates', () => {
    expect(
      estimateCost(undefined, { inputPerMillion: 1, outputPerMillion: 2 }),
    ).toBeNull();
    expect(estimateCost({ inputTokens: 10, outputTokens: 20 })).toBeNull();
    expect(
      estimateCost(
        { inputTokens: 1_000_000, outputTokens: 500_000 },
        { inputPerMillion: 1, outputPerMillion: 2 },
      ),
    ).toBe(2);
    expect(() =>
      estimateCost(
        { inputTokens: 1, outputTokens: 1 },
        { inputPerMillion: -1, outputPerMillion: 2 },
      ),
    ).toThrow();
  });

  it('validates capture files and refuses duplicate or falsely successful captures', () => {
    expect(
      parseCaptures({ schemaVersion: '1.0.0', captures: [capture()] }),
    ).toHaveLength(1);
    expect(() =>
      parseCaptures({
        schemaVersion: '1.0.0',
        captures: [capture(), capture()],
      }),
    ).toThrow();
    expect(() =>
      parseCaptures({
        schemaVersion: '1.0.0',
        captures: [{ ...capture(), report: null }],
      }),
    ).toThrow();
    expect(() =>
      parseCaptures({
        schemaVersion: '1.0.0',
        captures: [{ ...capture(), fixtureId: 'unknown' }],
      }),
    ).toThrow();
  });

  it('validates result provenance, complete A/B pairing and honest mock metrics', () => {
    expect(parseEvaluationRun(run()).records).toHaveLength(2);
    const bad = run();
    bad.records[1]!.recordId = bad.records[0]!.recordId;
    expect(() => parseEvaluationRun(bad)).toThrow();
    const billed = run();
    billed.records[0]!.metrics.inputTokens = 100;
    expect(() => parseEvaluationRun(billed)).toThrow();
    const foreign = run();
    foreign.records[0]!.diagnostic!.reportId = 'other-report';
    expect(() => parseEvaluationRun(foreign)).toThrow();
  });

  it('keeps method mapping out of the reviewer packet and starts all scores ungraded', () => {
    const generated = makeReview(run());
    expect(generated.packet.warning).toContain('MOCK RUN');
    expect(generated.mapping.items).toHaveLength(2);
    expect(JSON.stringify(generated.packet)).not.toContain('"method"');
    expect(
      generated.template.items.every(
        (item) => item.causeIdentification === null && item.reviewer === '',
      ),
    ).toBe(true);
    expect(() => gradeReview(run(), {}, {})).toThrow(/Mock protocol/);
  });

  it('requires complete independent human ratings and preserves missing latency as unknown', () => {
    const evaluation = run('gemini');
    const generated = completedReview(evaluation);
    expect(() =>
      gradeReview(evaluation, generated.template, generated.mapping),
    ).toThrow();
    const graded = gradeReview(evaluation, generated.review, generated.mapping);
    expect(graded.byMethod.map((item) => item.meanAPILatencyMs)).toEqual([
      null,
      null,
    ]);
    expect(
      graded.byMethod.every((item) => item.estimatedCostUSD === null),
    ).toBe(true);
    expect(graded.byMethod.every((item) => item.reviewedCases === 1)).toBe(
      true,
    );
  });

  it('rejects mapping duplication that could hide a failed case', () => {
    const evaluation = run('gemini');
    const generated = completedReview(evaluation);
    generated.mapping.items[1]!.recordId = generated.mapping.items[0]!.recordId;
    expect(() =>
      gradeReview(evaluation, generated.review, generated.mapping),
    ).toThrow(/exactly once/);
  });

  it('requires zero causal and actionability credit when a provider result failed', () => {
    const evaluation = run('gemini');
    evaluation.records[0]!.diagnostic = null;
    evaluation.records[0]!.error = 'Synthetic provider failure';
    evaluation.summary.protocolValidResults = 1;
    evaluation.summary.failedResults = 1;
    const generated = completedReview(evaluation);
    expect(() =>
      gradeReview(evaluation, generated.review, generated.mapping),
    ).toThrow(/must receive zero/);
    const row = generated.mapping.items.find(
      (item) => item.recordId === evaluation.records[0]!.recordId,
    )!;
    generated.review.items.find(
      (item) => item.reviewId === row.reviewId,
    )!.actionability = 0;
    expect(
      gradeReview(evaluation, generated.review, generated.mapping).byMethod[0]!
        .failedResults,
    ).toBe(1);
  });

  it('refuses a live adapter before browser launch or reading a credential unless --allow-live is explicit', () => {
    const tsx = JSON.parse(
      readFileSync(
        new URL('../../node_modules/tsx/package.json', import.meta.url),
        'utf8',
      ),
    ) as { bin: string };
    const cli = new URL(`../../node_modules/tsx/${tsx.bin}`, import.meta.url);
    const result = spawnSync(
      process.execPath,
      [
        cli.pathname.replace(/^\/(\w:)/, '$1'),
        'eval/cli.ts',
        'run',
        '--adapter',
        'gemini',
      ],
      {
        cwd: new URL('../..', import.meta.url),
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, GEMINI_API_KEY: '' },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Live API requests are disabled');
  });
});
