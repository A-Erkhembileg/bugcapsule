import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  aiContentSchema,
  finalizeDiagnostic,
  validateDiagnosticEvidence,
  validateDiagnosticForReport,
} from '../../src/ai/schema';
import type { AiContent } from '../../src/ai/schema';
import {
  AI_INPUT_LIMIT,
  buildDiagnosticPayload,
  evidenceIdsFromPayload,
  parseDiagnosticPayload,
} from '../../src/ai/payload';
import {
  createReport,
  exportZip,
  normalizeEvent,
  reportMarkdown,
  reportSchema,
  restorePortableReport,
  sanitizedReport,
  serializeReport,
} from '../../src/core';

const NOW = Date.UTC(2026, 10, 2);
function report() {
  const value = createReport(
    {
      url: 'https://user:pass@demo.test/path?token=private#secret',
      browser: 'Chromium',
      viewport: { width: 800, height: 600, devicePixelRatio: 1 },
      language: 'en',
    },
    NOW,
    'report-example',
  );
  value.events = [
    normalizeEvent(
      {
        kind: 'error',
        message: 'Cannot read properties of undefined',
        source: 'https://demo.test/app.js?key=private',
        line: 12,
        stack: 'at save (https://demo.test/app.js?key=private)',
      },
      NOW,
      NOW + 250,
    )!,
  ];
  value.title = 'Save button fails';
  value.privacyReviewed = true;
  return value;
}

function content(id: string): AiContent {
  return {
    summary: 'The save action emitted a JavaScript error.',
    observations: [
      {
        description: 'An undefined property access was recorded.',
        eventIds: [id],
      },
    ],
    hypotheses: [
      {
        hypothesisId: 'H1',
        title: 'Missing save input',
        explanation: 'An absent value may reach the save handler.',
        supportingEventIds: [id],
        contradictingEventIds: [],
        suggestedFix: 'Validate the input once the missing value is confirmed.',
        verificationSteps: [
          'Pause on the error and inspect the value used on the reported line.',
        ],
        uncertaintyNotes: 'The source and data flow have not been inspected.',
      },
    ],
    recommendedDebuggingSteps: ['Enable pause on exceptions and repeat Save.'],
    missingEvidence: ['The handler source and failing input.'],
    limitations: ['Captured diagnostics cannot establish a tested root cause.'],
  };
}

function analysis(value = report()) {
  return finalizeDiagnostic(content(value.events[0]!.id), {
    reportId: value.id,
    model: 'gemini-3.5-flash-lite',
    evidenceIds: [value.events[0]!.id],
    analysisId: 'analysis-example',
    generatedAt: new Date(NOW).toISOString(),
  });
}

describe('grounded structured diagnostics', () => {
  it('assigns provenance locally and validates real event links', () => {
    const value = report();
    const result = analysis(value);
    expect(result).toMatchObject({
      schemaVersion: '1.0.0',
      provider: 'google-gemini',
      promptVersion: '2.0.0',
      reportId: value.id,
      analysisId: 'analysis-example',
    });
    expect(
      validateDiagnosticForReport(
        result,
        value.id,
        value.events.map((event) => event.id),
      ),
    ).toEqual(result);
    expect(() =>
      validateDiagnosticForReport(
        result,
        'different-report',
        value.events.map((event) => event.id),
      ),
    ).toThrow(/different report/);
  });

  it('rejects fabricated references, duplicate hypotheses, unsupported confidence and provider metadata', () => {
    const value = report();
    const good = content(value.events[0]!.id);
    expect(() =>
      validateDiagnosticEvidence(content('invented-event'), [
        value.events[0]!.id,
      ]),
    ).toThrow(/not supplied/);
    expect(() =>
      validateDiagnosticEvidence(
        { ...good, hypotheses: [...good.hypotheses, ...good.hypotheses] },
        [value.events[0]!.id],
      ),
    ).toThrow(/duplicate/);
    expect(
      aiContentSchema.safeParse({ ...good, confidence: 0.99 }).success,
    ).toBe(false);
    expect(
      aiContentSchema.safeParse({ ...good, model: 'invented-model' }).success,
    ).toBe(false);
    const contradictory = {
      ...good,
      hypotheses: [
        {
          ...good.hypotheses[0]!,
          contradictingEventIds: [value.events[0]!.id],
        },
      ],
    };
    expect(() =>
      validateDiagnosticEvidence(contradictory, [value.events[0]!.id]),
    ).toThrow(/both support and contradict/);
  });

  it('allows insufficient evidence without inventing a hypothesis', () => {
    const value = { ...content('unused'), observations: [], hypotheses: [] };
    expect(
      finalizeDiagnostic(value, {
        reportId: 'empty-report',
        model: 'gemini-3.8-flash',
        evidenceIds: [],
      }).hypotheses,
    ).toEqual([]);
  });

  it('rejects ambiguous report identifiers and orphaned structured analysis', () => {
    const value = report();
    expect(
      reportSchema.safeParse({
        ...value,
        events: [...value.events, ...value.events],
      }).success,
    ).toBe(false);
    expect(
      reportSchema.safeParse({
        ...value,
        aiDiagnostic: { ...analysis(value), evidenceIds: ['not-captured'] },
      }).success,
    ).toBe(false);
    expect(
      reportSchema.safeParse({
        ...value,
        aiDiagnostic: { ...analysis(value), reportId: 'other' },
      }).success,
    ).toBe(false);
  });

  it('sanitizes generated prose and exports structured provenance deterministically and safely', () => {
    const value = report();
    const generated = content(value.events[0]!.id);
    generated.summary =
      '<img src=https://evil.test/pixel> token=never-export-this';
    value.aiDiagnostic = finalizeDiagnostic(generated, {
      reportId: value.id,
      model: 'gemini-3.8-flash',
      evidenceIds: [value.events[0]!.id],
    });
    const json = serializeReport(value);
    expect(json).not.toContain('never-export-this');
    const markdown = reportMarkdown(value);
    expect(markdown).toContain('Prompt version: 2.0.0');
    expect(markdown.replace(/\\/g, '')).toContain(value.events[0]!.id);
    expect(markdown).toContain('&lt;img');
    expect(markdown).not.toContain('<img');
    const zip = exportZip(value);
    expect(exportZip(value)).toEqual(zip);
    const files = unzipSync(zip);
    expect(strFromU8(files['report.json']!)).toBe(json);
    expect(strFromU8(files['report.md']!)).toBe(markdown);
  });
});

describe('evidence selection and import compatibility', () => {
  it('preserves aliases and first timestamps when deduplicating errors', () => {
    const value = report();
    const duplicate = {
      ...value.events[0]!,
      id: 'duplicate-event',
      offsetMs: 500,
      timestamp: new Date(NOW + 500).toISOString(),
    };
    value.events.push(duplicate);
    const payload = parseDiagnosticPayload(buildDiagnosticPayload(value));
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]).toMatchObject({
      id: value.events[0]!.id,
      eventIds: [value.events[0]!.id, 'duplicate-event'],
      timestamp: value.events[0]!.timestamp,
      occurrences: 2,
    });
    expect(payload.errors[0]!.stack).toContain('app.js');
    expect(JSON.stringify(payload)).not.toContain('key=private');
    expect(evidenceIdsFromPayload(JSON.stringify(payload))).toEqual([
      value.events[0]!.id,
      'duplicate-event',
    ]);
  });

  it('excludes screenshot, old AI output, arbitrary attributes and private click messages', () => {
    const value = report();
    value.aiDiagnostic = 'Previous analysis should not be supplied again.';
    value.events.push(
      normalizeEvent(
        { kind: 'click', message: 'Clicked password=private-form-value' },
        NOW,
        NOW + 600,
      )!,
    );
    const payload = buildDiagnosticPayload(value);
    expect(payload).not.toContain('Previous analysis');
    expect(payload).not.toContain('private-form-value');
    expect(payload).not.toContain('aiDiagnostic');
    expect(JSON.parse(payload)).not.toHaveProperty('screenshot');
    expect(parseDiagnosticPayload(payload).timeline[0]!.message).toBe(
      'Clicked page element',
    );
  });

  it('honors the JSON size budget even with escaped valid strings', () => {
    const value = report();
    value.description = '\\'.repeat(10_000);
    value.expectedBehavior = '\\'.repeat(5_000);
    value.actualBehavior = '\\'.repeat(5_000);
    value.steps = Array.from({ length: 50 }, () => '\\'.repeat(2_000));
    const payload = buildDiagnosticPayload(value);
    expect(payload.length).toBeLessThanOrEqual(AI_INPUT_LIMIT);
    expect(parseDiagnosticPayload(payload).errors[0]!.id).toBe(
      value.events[0]!.id,
    );
  });

  it('accepts minimal baseline inputs and rejects alias ambiguity', () => {
    const event = report().events[0]!;
    const minimal = {
      reportId: 'baseline-report',
      errors: [{ ...event, eventIds: [event.id] }],
      timeline: [],
    };
    expect(parseDiagnosticPayload(JSON.stringify(minimal)).reportId).toBe(
      'baseline-report',
    );
    expect(() =>
      parseDiagnosticPayload(
        JSON.stringify({
          ...minimal,
          errors: [...minimal.errors, ...minimal.errors],
        }),
      ),
    ).toThrow(/unique/);
  });

  it('keeps legacy versions and free-form analysis without inventing provenance', () => {
    for (const schemaVersion of ['1.0.0', '1.1.0'] as const) {
      const value = { ...report(), schemaVersion, privacyReviewed: true };
      const restored = restorePortableReport(
        JSON.parse(serializeReport(value)),
      );
      expect(restored.schemaVersion).toBe(schemaVersion);
      expect(restored.privacyReviewed).toBe(false);
      expect(restored.aiDiagnostic).toBeUndefined();
    }
    const legacy = {
      ...report(),
      schemaVersion: '1.1.0' as const,
      aiDiagnostic: 'Historical hypothesis',
    };
    const restored = restorePortableReport(JSON.parse(serializeReport(legacy)));
    expect(restored.aiDiagnostic).toBe('Historical hypothesis');
    expect(reportMarkdown({ ...restored, privacyReviewed: true })).toContain(
      'were not recorded',
    );
  });

  it('restores structured reports, resets review and rejects unknown private configuration', () => {
    const value = report();
    value.aiDiagnostic = analysis(value);
    const restored = restorePortableReport(JSON.parse(serializeReport(value)));
    expect(restored.aiDiagnostic).toEqual(value.aiDiagnostic);
    expect(restored.privacyReviewed).toBe(false);
    expect(() =>
      restorePortableReport({ ...value, apiKey: 'not-a-report-field' }),
    ).toThrow();
    expect(
      sanitizedReport({ ...value, schemaVersion: '1.0.0' }).schemaVersion,
    ).toBe('1.2.0');
  });

  it('drops a portable screenshot reference because no image bytes were imported', () => {
    const value = report();
    const portable = JSON.parse(serializeReport(value));
    portable.screenshot = {
      file: 'screenshot.png',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      redacted: true,
    };
    expect(restorePortableReport(portable).screenshot).toBeUndefined();
  });

  it('checks internal PNG dimensions before an imported image can be decoded by the UI', () => {
    const value = report();
    const pngHeader = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(pngHeader);
    pngHeader.writeUInt32BE(13, 8);
    pngHeader.write('IHDR', 12);
    pngHeader.writeUInt32BE(6000, 16);
    pngHeader.writeUInt32BE(6000, 20);
    const dataUrl = 'data:image/png;base64,' + pngHeader.toString('base64');
    expect(() =>
      restorePortableReport({
        ...value,
        screenshot: { dataUrl, width: 1, height: 1, redacted: false },
      }),
    ).toThrow(/dimensions/);
    expect(() =>
      restorePortableReport({
        ...value,
        screenshot: { dataUrl, width: 6000, height: 6000, redacted: false },
      }),
    ).toThrow(/16-million/);
    pngHeader.writeUInt32BE(1, 16);
    pngHeader.writeUInt32BE(1, 20);
    expect(
      restorePortableReport({
        ...value,
        screenshot: {
          dataUrl: 'data:image/png;base64,' + pngHeader.toString('base64'),
          width: 1,
          height: 1,
          redacted: false,
        },
      }).screenshot?.width,
    ).toBe(1);
  });
});
