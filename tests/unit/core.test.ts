import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { z } from 'zod';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  createEmptyState,
  createReport,
  exportedReportSchema,
  exportZip,
  MAX_EVENTS,
  MAX_SCREENSHOT_LENGTH,
  normalizeEvent,
  previewReportMarkdown,
  reportMarkdown,
  reportSchema,
  sanitizeText,
  sanitizeUrl,
  serializeReport,
  stateSchema,
} from '../../src/core';
import type { Environment, Report } from '../../src/shared/types';

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);
const environment: Environment = {
  url: 'https://user:password@example.test/demo?token=secret#private',
  browser: 'Chromium demo',
  viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
  language: 'en-US',
};
const ONE_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

function report(): Report {
  const draft = createReport(environment, NOW, 'report-fixture');
  draft.title = 'Checkout fails';
  draft.description = 'The cart stays open.';
  draft.expectedBehavior = 'Show a confirmation.';
  draft.actualBehavior = 'Show a JavaScript error.';
  draft.steps = ['Add a product', 'Choose checkout'];
  draft.privacyReviewed = true;
  return draft;
}

describe('capture state and report boundaries', () => {
  it('starts with collection disabled and no persisted content', () => {
    expect(createEmptyState()).toEqual({
      report: null,
      active: false,
      tabId: null,
      startedAt: null,
      timelineEnabled: false,
      notice: null,
      droppedEvents: 0,
    });
    expect(stateSchema.safeParse(createEmptyState()).success).toBe(true);
    expect(
      stateSchema.safeParse({ ...createEmptyState(), active: true }).success,
    ).toBe(false);
  });

  it('initializes a versioned unapproved report with sanitized environment', () => {
    const draft = createReport(environment, NOW, 'new-report');
    expect(draft.schemaVersion).toBe('1.2.0');
    expect(draft.createdAt).toBe('2026-10-31T12:00:00.000Z');
    expect(draft.environment.url).toBe('https://example.test/demo');
    expect(draft.events).toEqual([]);
    expect(draft.privacyReviewed).toBe(false);
  });

  it('rejects unknown fields, oversized text, invalid dates and event overflows', () => {
    expect(
      reportSchema.safeParse({ ...report(), cookies: 'secret' }).success,
    ).toBe(false);
    expect(
      reportSchema.safeParse({ ...report(), title: 'a'.repeat(201) }).success,
    ).toBe(false);
    expect(
      reportSchema.safeParse({ ...report(), createdAt: 'yesterday' }).success,
    ).toBe(false);
    const event = normalizeEvent(
      { kind: 'error', message: 'Oops' },
      NOW,
      NOW + 1,
    )!;
    expect(
      reportSchema.safeParse({
        ...report(),
        events: Array.from({ length: MAX_EVENTS + 1 }, () => event),
      }).success,
    ).toBe(false);
  });

  it('requires PNG screenshots and bounds image size', () => {
    const screenshot = {
      dataUrl: ONE_PIXEL,
      width: 1,
      height: 1,
      redacted: true,
    };
    expect(reportSchema.safeParse({ ...report(), screenshot }).success).toBe(
      true,
    );
    expect(
      reportSchema.safeParse({
        ...report(),
        screenshot: {
          ...screenshot,
          dataUrl: 'data:text/html,<script>alert(1)</script>',
        },
      }).success,
    ).toBe(false);
    expect(
      reportSchema.safeParse({
        ...report(),
        screenshot: { ...screenshot, width: 0 },
      }).success,
    ).toBe(false);
    expect(
      reportSchema.safeParse({
        ...report(),
        screenshot: {
          ...screenshot,
          dataUrl: ONE_PIXEL + 'a'.repeat(MAX_SCREENSHOT_LENGTH),
        },
      }).success,
    ).toBe(false);
  });
});

describe('privacy filters', () => {
  it('removes query, fragment and URL credentials', () => {
    expect(sanitizeUrl(environment.url)).toBe('https://example.test/demo');
    expect(
      sanitizeText('Failed at https://u:p@example.test/app?secret=yes#token'),
    ).toBe('Failed at https://example.test/app');
  });

  it.each([
    'javascript:alert(1)',
    'file:///private/account.txt',
    'data:text/plain,secret',
    'not a URL',
  ])('does not retain unsafe or ambiguous location %s', (url) => {
    expect(sanitizeUrl(url)).toBe('[location unavailable]');
  });

  it('allows removing location information', () => {
    expect(sanitizeUrl('')).toBe('');
    const draft = report();
    draft.environment.url = '';
    expect(JSON.parse(serializeReport(draft)).environment.url).toBe('');
  });

  it('redacts known token, credential, cookie and email patterns', () => {
    expect(sanitizeText('AIza' + 'A'.repeat(35))).toBe('[REDACTED API key]');
    const input =
      'password="multi word secret" api_key=abcdef Authorization: Bearer abcdef123 token=abc person@example.test ghp_1234567890 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature';
    const output = sanitizeText(input);
    for (const secret of [
      'multi word secret',
      'abcdef',
      'abcdef123',
      'person@example.test',
      'ghp_1234567890',
      'eyJhbGci',
      'token=abc',
    ])
      expect(output).not.toContain(secret);
    expect(sanitizeText('Cookie: session=abc; refresh=def\nerror')).toBe(
      'Cookie: [REDACTED]\nerror',
    );
    expect(sanitizeText('{"client_secret":"something private"}')).not.toContain(
      'something private',
    );
    for (const key of [
      'accessToken',
      'refresh-token',
      'sessionId',
      'apiKey',
      'clientSecret',
    ]) {
      expect(sanitizeText(`${key}=synthetic-private-value`)).toBe(
        `${key}=[REDACTED]`,
      );
    }
    expect(sanitizeText('password="incomplete quoted secret')).toBe(
      'password=[REDACTED]',
    );
  });

  it('caps stored text and strips control characters', () => {
    expect(sanitizeText('a'.repeat(5_000))).toHaveLength(2_000);
    expect(sanitizeText('a\u0000b\n')).toBe('ab\n');
    expect(sanitizeText('hello', 0)).toBe('');
  });

  it('makes no claim to detect arbitrary private prose', () => {
    expect(sanitizeText('Our unreleased project is Atlas')).toBe(
      'Our unreleased project is Atlas',
    );
  });
});

describe('untrusted event normalization', () => {
  it('assigns its own timestamp, identity and relative offset', () => {
    const event = normalizeEvent(
      {
        kind: 'error',
        message: 'Failed token=secret',
        source: environment.url,
        line: 12,
        column: 3,
      },
      NOW,
      NOW + 1500,
    )!;
    expect(event.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(event.timestamp).toBe('2026-10-31T12:00:01.500Z');
    expect(event.offsetMs).toBe(1500);
    expect(event.message).toBe('Failed token=[REDACTED]');
    expect(event.source).toBe('https://example.test/demo');
    expect(event.line).toBe(12);
    expect(event.column).toBe(3);
  });

  it('supports missing script locations and primitive rejection messages', () => {
    expect(
      normalizeEvent(
        {
          kind: 'unhandled-rejection',
          message: '[non-primitive rejection omitted]',
        },
        NOW,
        NOW,
      )?.source,
    ).toBeUndefined();
    expect(
      normalizeEvent({ kind: 'console-error', message: 'Error' }, NOW, NOW - 10)
        ?.offsetMs,
    ).toBe(0);
  });

  it('rejects malformed events instead of traversing object contents', () => {
    for (const input of [
      null,
      'text',
      {},
      { kind: 'error', message: { password: 'secret' } },
      { kind: 'keydown', message: 'secret' },
      { kind: 'error', message: 'a', cookies: 'secret' },
      { kind: 'error', message: 'a', line: -1 },
    ]) {
      expect(normalizeEvent(input, NOW, NOW)).toBeNull();
    }
    expect(
      normalizeEvent({ kind: 'error', message: 'a' }, NaN, NOW),
    ).toBeNull();
    expect(
      normalizeEvent({ kind: 'error', message: 'a' }, NOW, Infinity),
    ).toBeNull();
  });

  it('bounds message and stack independently', () => {
    const event = normalizeEvent(
      { kind: 'error', message: 'm'.repeat(10_000), stack: 's'.repeat(10_000) },
      NOW,
      NOW,
    )!;
    expect(event.message).toHaveLength(2_000);
    expect(event.stack).toHaveLength(4_000);
  });
});

describe('reviewable and deterministic exports', () => {
  it('preserves ordinary version 1.0.0 reports and upgrades legacy reports with AI text', () => {
    const legacy = { ...report(), schemaVersion: '1.0.0' as const };
    expect(reportSchema.safeParse(legacy).success).toBe(true);
    expect(JSON.parse(serializeReport(legacy)).schemaVersion).toBe('1.0.0');
    expect(serializeReport(legacy)).not.toContain('aiDiagnostic');
    legacy.aiDiagnostic = 'A hypothesis for the recorded error.';
    expect(JSON.parse(serializeReport(legacy)).schemaVersion).toBe('1.1.0');
    expect(legacy.schemaVersion).toBe('1.0.0');
    expect(exportedReportSchema.safeParse(legacy).success).toBe(false);
  });

  it('includes bounded, sanitized AI hypotheses in every export and safely fences Markdown', () => {
    const draft = report();
    draft.aiDiagnostic =
      '## Hypothesis\nCheck token=private-ai-value\n```\n<img src=x onerror=alert(1)>\n```';
    const json = serializeReport(draft);
    const parsed = exportedReportSchema.parse(JSON.parse(json));
    expect(parsed.aiDiagnostic).toContain('token=[REDACTED]');
    expect(json).not.toContain('private-ai-value');
    expect(draft.aiDiagnostic).toContain('private-ai-value');
    const markdown = reportMarkdown(draft);
    expect(markdown).toContain('## AI diagnostic');
    expect(markdown).toContain('AI-generated debugging hypotheses');
    expect(markdown).toContain('````text');
    expect(markdown).not.toContain('private-ai-value');
    const archive = unzipSync(exportZip(draft));
    expect(strFromU8(archive['report.json']!)).toBe(json);
    expect(strFromU8(archive['report.md']!)).toBe(markdown);
    expect(exportZip(draft)).toEqual(exportZip(draft));
    expect(
      reportSchema.safeParse({ ...draft, aiDiagnostic: 'a'.repeat(12_001) })
        .success,
    ).toBe(false);
  });
  it('blocks every downloadable format until privacy approval', () => {
    const draft = report();
    draft.privacyReviewed = false;
    expect(() => serializeReport(draft)).toThrow(/review/i);
    expect(() => reportMarkdown(draft)).toThrow(/review/i);
    expect(() => exportZip(draft)).toThrow(/review/i);
    expect(previewReportMarkdown(draft)).toContain('pending');
  });

  it('emits deterministic JSON and ordered relative timeline entries', () => {
    const draft = report();
    draft.events = [
      normalizeEvent(
        { kind: 'click', message: 'Clicked button' },
        NOW,
        NOW + 200,
      )!,
      normalizeEvent({ kind: 'error', message: 'Failure' }, NOW, NOW + 450)!,
    ];
    const json = serializeReport(draft);
    expect(serializeReport(draft)).toBe(json);
    const parsed = exportedReportSchema.parse(JSON.parse(json));
    expect(parsed.events.map((event) => event.offsetMs)).toEqual([200, 450]);
    expect(reportMarkdown(draft)).toContain('+0.450s');
    expect(reportMarkdown(draft)).toContain('1. Add a product');
  });

  it('sanitizes user edits at export without mutating the draft', () => {
    const draft = report();
    draft.description = 'token=private-value';
    expect(serializeReport(draft)).not.toContain('private-value');
    expect(draft.description).toBe('token=private-value');
  });

  it('escapes Markdown text and contains code-fence injection', () => {
    const draft = report();
    draft.title = '<img src=x onerror=alert(1)> [click](https://evil.test/)';
    draft.events = [
      normalizeEvent(
        { kind: 'error', message: '```\n<img src=x>\n```' },
        NOW,
        NOW,
      )!,
    ];
    const markdown = reportMarkdown(draft);
    expect(markdown).toContain('&lt;img');
    expect(markdown).toContain('\\[click\\]');
    expect(markdown).toContain('````text');
  });

  it('includes only approved PNG bytes in a stable ZIP and metadata in JSON', () => {
    const draft = report();
    draft.screenshot = {
      dataUrl: ONE_PIXEL,
      width: 1,
      height: 1,
      redacted: true,
    };
    const archive = exportZip(draft);
    expect(exportZip(draft)).toEqual(archive);
    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual([
      'report.md',
      'report.json',
      'screenshot.png',
    ]);
    expect([...files['screenshot.png']!.slice(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    const json = strFromU8(files['report.json']!);
    expect(json).not.toContain('dataUrl');
    expect(json).not.toContain('base64');
    expect(JSON.parse(json).screenshot).toEqual({
      file: 'screenshot.png',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      redacted: true,
    });
    expect(strFromU8(files['report.md']!)).toBe(reportMarkdown(draft));
  });

  it('excludes removed screenshots from every export', () => {
    const draft = report();
    expect(Object.keys(unzipSync(exportZip(draft)))).toEqual([
      'report.md',
      'report.json',
    ]);
    expect(serializeReport(draft)).not.toContain('screenshot');
    expect(reportMarkdown(draft)).toContain('No screenshot included');
  });

  it('ships a standard JSON schema matching runtime validation', () => {
    const schema = JSON.parse(
      readFileSync(
        new URL('../../public/report.schema.json', import.meta.url),
        'utf8',
      ),
    );
    expect(schema).toEqual(
      z.toJSONSchema(exportedReportSchema, { target: 'draft-7' }),
    );
    const ajv = new Ajv();
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(JSON.parse(serializeReport(report())))).toBe(true);
    expect(
      validate({
        ...JSON.parse(serializeReport(report())),
        schemaVersion: '99.0.0',
      }),
    ).toBe(false);
    expect(
      validate({
        ...JSON.parse(serializeReport(report())),
        createdAt: 'yesterday',
      }),
    ).toBe(false);
    expect(
      validate({
        ...JSON.parse(serializeReport(report())),
        requestBody: 'private',
      }),
    ).toBe(false);
  });
});
