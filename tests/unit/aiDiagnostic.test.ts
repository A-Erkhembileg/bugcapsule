import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReport, normalizeEvent } from '../../src/core';
import type { Report } from '../../src/shared/types';
import type { AiContent } from '../../src/ai/schema';
import {
  AI_INPUT_LIMIT,
  AI_OUTPUT_LIMIT,
  AIDiagnosticError,
  buildDiagnosticPayload,
  diagnosticFingerprint,
  DIAGNOSTIC_SYSTEM_PROMPT,
  GEMINI_ENDPOINT,
  GEMINI_MODEL,
  GeminiKeyStore,
  runGeminiDiagnostic,
} from '../../src/services/aiDiagnostic';

const KEY = 'test-key-not-a-real-credential';
const NOW = Date.UTC(2026, 10, 1, 12);

function report(): Report {
  return createReport(
    {
      url: 'https://user:password@demo.test/save?token=private-query#fragment',
      browser: 'Test Chromium',
      viewport: { width: 1200, height: 800, devicePixelRatio: 1 },
      language: 'en',
    },
    NOW,
    'synthetic-ai-report',
  );
}

function content(overrides: Partial<AiContent> = {}): AiContent {
  return {
    summary: 'A missing identifier may explain the observed failure.',
    observations: [],
    hypotheses: [],
    recommendedDebuggingSteps: [
      'Inspect the captured handler and verify its identifier.',
    ],
    missingEvidence: ['The application source is unavailable.'],
    limitations: ['This synthetic response is not a verified root cause.'],
    ...overrides,
  };
}

function response(
  value: AiContent = content(),
  extra: Record<string, unknown> = {},
) {
  return Response.json({
    candidates: [
      {
        finishReason: 'STOP',
        content: { parts: [{ text: JSON.stringify(value) }] },
      },
    ],
    ...extra,
  });
}

function payload() {
  return buildDiagnosticPayload(report());
}

it('cancels a failed HTTP response body before attempting a permitted retry', async () => {
  const failed = new Response('Temporary upstream error', { status: 503 });
  const cancel = vi.spyOn(failed.body!, 'cancel');
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(failed)
    .mockResolvedValueOnce(response());
  await runGeminiDiagnostic(payload(), KEY, {
    fetcher,
    maxRetries: 1,
    random: () => 0,
    retryDelay: async () => {
      expect(cancel).toHaveBeenCalledOnce();
    },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

function storage() {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({
    setAccessLevel: vi.fn(async () => {}),
    get: vi.fn(async (key: string) => ({ [key]: data[key] })),
    set: vi.fn(async (value: Record<string, unknown>) => {
      Object.assign(data, value);
    }),
    remove: vi.fn(async (key: string) => {
      delete data[key];
    }),
  });
  const api = { storage: { local: area(local), session: area(session) } };
  return {
    local,
    session,
    api,
    keys: new GeminiKeyStore(api as unknown as typeof chrome),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AI outbound payload', () => {
  it('sends a re-sanitized field allowlist without image, credentials or previous analysis', () => {
    const draft = report();
    draft.title = 'Save fails';
    draft.description = 'Authorization: Bearer synthetic-secret';
    draft.steps = [
      'Open https://demo.test/path?secret=private-step',
      'password=private-password',
    ];
    draft.aiDiagnostic = 'Previous analysis must never be sent';
    draft.schemaVersion = '1.1.0';
    draft.screenshot = {
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      width: 1,
      height: 1,
      redacted: false,
    };
    const encoded = buildDiagnosticPayload(draft);
    const payload = JSON.parse(encoded);
    expect(payload.environment.url).toBe('https://demo.test/save');
    expect(payload.title).toBe('Save fails');
    expect(payload.reportId).toBe(draft.id);
    for (const excluded of [
      'synthetic-secret',
      'private-query',
      'private-step',
      'private-password',
      'Previous analysis must never be sent',
      'data:image',
    ]) {
      expect(encoded).not.toContain(excluded);
    }
    expect(payload).not.toHaveProperty('screenshot');
    expect(payload).not.toHaveProperty('aiDiagnostic');
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('createdAt');
    expect(draft.description).toContain('synthetic-secret');
  });

  it('deduplicates diagnostic events and compresses safe action noise', () => {
    const draft = report();
    const failure = normalizeEvent(
      {
        kind: 'error',
        message: 'Save failed',
        source: 'https://demo.test/app.js?key=secret',
        stack: 'Error at save',
      },
      NOW,
      NOW + 10,
    )!;
    draft.events = [
      failure,
      { ...failure, id: 'duplicate' },
      normalizeEvent(
        { kind: 'click', message: 'Clicked button' },
        NOW,
        NOW + 20,
      )!,
      normalizeEvent(
        { kind: 'click', message: 'Clicked button' },
        NOW,
        NOW + 21,
      )!,
      normalizeEvent(
        { kind: 'click', message: 'Pretend private text' },
        NOW,
        NOW + 22,
      )!,
    ];
    const payload = JSON.parse(buildDiagnosticPayload(draft));
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0]).toMatchObject({
      kind: 'error',
      message: 'Save failed',
      occurrences: 2,
      source: 'https://demo.test/app.js',
    });
    expect(payload.timeline).toMatchObject([
      { offsetMs: 20, message: 'Clicked button', occurrences: 2 },
      { offsetMs: 22, message: 'Clicked page element', occurrences: 1 },
    ]);
    expect(payload.errors[0].id).toBe(failure.id);
    expect(payload.errors[0].eventIds).toContain('duplicate');
    expect(payload.errors[0].timestamp).toBe(failure.timestamp);
  });

  it('keeps a valid JSON object inside the input budget for maximum report bounds', () => {
    const draft = report();
    draft.description = 'd'.repeat(10_000);
    draft.expectedBehavior = 'e'.repeat(5_000);
    draft.actualBehavior = 'a'.repeat(5_000);
    draft.steps = Array.from({ length: 50 }, () => 's'.repeat(2_000));
    draft.events = Array.from({ length: 200 }, (_, index) =>
      normalizeEvent(
        {
          kind: 'error',
          message: `${index} ${'m'.repeat(1900)}`,
          stack: 'k'.repeat(4000),
        },
        NOW,
        NOW + index,
      )!,
    );
    const encoded = buildDiagnosticPayload(draft);
    expect(encoded.length).toBeLessThanOrEqual(AI_INPUT_LIMIT);
    const payload = JSON.parse(encoded);
    expect(payload.errors.length).toBeGreaterThan(0);
    expect(payload.errors.length).toBeLessThanOrEqual(12);
    expect(payload.steps.length).toBeLessThanOrEqual(20);
  });

  it('binds the preview fingerprint to exact outbound content', async () => {
    const payload = buildDiagnosticPayload(report());
    expect(await diagnosticFingerprint(payload)).toMatch(/^[a-f0-9]{64}$/);
    expect(await diagnosticFingerprint(payload)).toBe(
      await diagnosticFingerprint(payload),
    );
    expect(await diagnosticFingerprint(payload + ' ')).not.toBe(
      await diagnosticFingerprint(payload),
    );
  });

  it('keeps heavily escaped report text within the serialized budget', () => {
    const draft = report();
    draft.description = '\\'.repeat(10_000);
    draft.expectedBehavior = '\\'.repeat(5_000);
    draft.actualBehavior = '\\'.repeat(5_000);
    draft.steps = Array.from({ length: 50 }, () => '\\'.repeat(2_000));
    draft.events = Array.from({ length: 200 }, (_, index) =>
      normalizeEvent(
        {
          kind: 'error',
          message: `${index}${'\\'.repeat(1900)}`,
          stack: '\\'.repeat(4000),
        },
        NOW,
        NOW + index,
      )!,
    );
    const encoded = buildDiagnosticPayload(draft);
    expect(encoded.length).toBeLessThanOrEqual(AI_INPUT_LIMIT);
    const selected = JSON.parse(encoded).errors as { eventIds: string[] }[];
    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(selected.length).toBeLessThanOrEqual(12);
    const actualIds = new Set(draft.events.map((event) => event.id));
    expect(
      selected
        .flatMap((event) => event.eventIds)
        .every((id) => actualIds.has(id)),
    ).toBe(true);
  });
});

describe('Gemini key retention', () => {
  it('uses trusted session storage by default and never exposes key material in status', async () => {
    const f = storage();
    await f.keys.save(KEY, false);
    expect(Object.values(f.local)).not.toContain(KEY);
    expect(Object.values(f.session)).toContain(KEY);
    expect(await f.keys.read()).toBe(KEY);
    expect(await f.keys.status()).toEqual({ hasKey: true, remembered: false });
    expect(f.api.storage.local.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    expect(f.api.storage.session.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
  });

  it('removes previous durable keys when retention switches and clears both stores', async () => {
    const f = storage();
    await f.keys.save(KEY, true);
    expect(await f.keys.status()).toEqual({ hasKey: true, remembered: true });
    await f.keys.save('replacement-test-key', false);
    expect(Object.values(f.local)).not.toContain(KEY);
    expect(await f.keys.read()).toBe('replacement-test-key');
    await f.keys.clear();
    expect(f.local).toEqual({});
    expect(f.session).toEqual({});
    expect(await f.keys.status()).toEqual({ hasKey: false, remembered: false });
  });

  it('rejects malformed keys and reports partial deletion failures', async () => {
    const f = storage();
    await expect(f.keys.save('a key with spaces', false)).rejects.toThrow(
      /valid Gemini API key/,
    );
    expect(f.api.storage.local.set).not.toHaveBeenCalled();
    f.api.storage.local.remove.mockRejectedValueOnce(
      new Error('device unavailable'),
    );
    await expect(f.keys.clear()).rejects.toThrow(/fully removed/);
    expect(f.api.storage.session.remove).toHaveBeenCalledOnce();
  });
});

describe('Gemini transport with synthetic provider responses', () => {
  it('preserves genuine evidence references and locally assigns provenance and usage metadata', async () => {
    const draft = report();
    const event = normalizeEvent(
      { kind: 'error', message: 'Missing draft identifier' },
      NOW,
      NOW + 50,
    )!;
    draft.events = [event];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        content({
          observations: [
            {
              description: 'The handler reported a missing identifier.',
              eventIds: [event.id],
            },
          ],
        }),
        {
          usageMetadata: {
            promptTokenCount: 42,
            candidatesTokenCount: 17,
            totalTokenCount: 59,
          },
        },
      ),
    );
    const result = await runGeminiDiagnostic(
      buildDiagnosticPayload(draft),
      KEY,
      { fetcher, model: 'gemini-3.8-flash' },
    );
    expect(result.model).toBe('gemini-3.8-flash');
    expect(result.reportId).toBe(draft.id);
    expect(result.evidenceIds).toEqual([event.id]);
    expect(result.observations[0]?.eventIds).toEqual([event.id]);
    expect(result.tokenUsage).toEqual({
      inputTokens: 42,
      outputTokens: 17,
      totalTokens: 59,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      '/gemini-3.8-flash:generateContent',
    );
  });

  it('rejects invented event references and unsupported properties rather than fabricating a result', async () => {
    for (const invalid of [
      content({
        observations: [
          {
            description: 'Unsupported event claim',
            eventIds: ['invented-event'],
          },
        ],
      }),
      { ...content(), confidence: 0.99 },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: JSON.stringify(invalid) }] },
            },
          ],
        }),
      );
      await expect(
        runGeminiDiagnostic(payload(), KEY, { fetcher, maxRetries: 2 }),
      ).rejects.toThrow(/invalid|invented/i);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it('retries transient failures only when enabled with bounded exponential jitter and no model fallback', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('Synthetic network interruption'))
      .mockResolvedValueOnce(new Response('Temporary failure', { status: 503 }))
      .mockResolvedValueOnce(response());
    const retryDelay = vi.fn<
      (ms: number, signal: AbortSignal) => Promise<void>
    >(async () => {});
    const onAttempt = vi.fn();
    const result = await runGeminiDiagnostic(payload(), KEY, {
      fetcher,
      maxRetries: 2,
      retryDelay,
      random: () => 0.25,
      model: 'gemini-3.8-flash',
      onAttempt,
    });
    expect(result.model).toBe('gemini-3.8-flash');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(retryDelay.mock.calls.map((call) => call[0])).toEqual([625, 1250]);
    expect(onAttempt.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
    expect(
      fetcher.mock.calls.every((call) =>
        String(call[0]).includes('gemini-3.8-flash:generateContent'),
      ),
    ).toBe(true);
  });

  it('does not retry authentication or unavailable-model errors even when retries are allowed', async () => {
    for (const status of [401, 403, 404]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('Provider details should remain private', { status }),
        );
      const retryDelay = vi.fn(async () => {});
      await expect(
        runGeminiDiagnostic(payload(), KEY, {
          fetcher,
          maxRetries: 2,
          retryDelay,
        }),
      ).rejects.toBeInstanceOf(AIDiagnosticError);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(retryDelay).not.toHaveBeenCalled();
    }
  });

  it('rejects invalid configuration or credentials before any provider request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      runGeminiDiagnostic(payload(), KEY, {
        fetcher,
        model: 'unapproved-model' as never,
      }),
    ).rejects.toThrow(/configuration/);
    await expect(
      runGeminiDiagnostic(payload(), KEY, { fetcher, maxRetries: 3 }),
    ).rejects.toThrow(/retry configuration/);
    await expect(
      runGeminiDiagnostic(payload(), 'contains spaces', { fetcher }),
    ).rejects.toThrow(/valid Gemini API key/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the fixed endpoint, key header and bounded instruction without tools', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    const payload = buildDiagnosticPayload(report());
    const result = await runGeminiDiagnostic(payload, KEY, { fetcher });
    expect(result.summary).toContain('missing identifier');
    expect(result.reportId).toBe('synthetic-ai-report');
    expect(result.provider).toBe('google-gemini');
    expect(result.promptVersion).toBe('2.0.0');
    expect(result.analysisId).toBeTruthy();
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe(GEMINI_ENDPOINT);
    expect(url).toContain(GEMINI_MODEL);
    expect(String(url)).not.toContain(KEY);
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(new Headers(options?.headers).get('x-goog-api-key')).toBe(KEY);
    const body = JSON.parse(String(options?.body));
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: payload }] },
    ]);
    expect(body.systemInstruction.parts[0].text).toBe(DIAGNOSTIC_SYSTEM_PROMPT);
    expect(body).not.toHaveProperty('tools');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema).toMatchObject({
      type: 'object',
    });
    expect(String(options?.body)).not.toContain(KEY);
  });

  it('returns actionable quota information once without retrying or echoing provider details', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('secret-provider-error', {
        status: 429,
        headers: { 'retry-after': '45' },
      }),
    );
    const failure = await runGeminiDiagnostic(payload(), KEY, {
      fetcher,
    }).catch((error) => error);
    expect(failure).toBeInstanceOf(AIDiagnosticError);
    expect(failure.retryAfterSeconds).toBe(45);
    expect(failure.message).toMatch(/quota|rate limit/i);
    expect(failure.message).not.toContain('secret-provider-error');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 404, 500])(
    'degrades safely on HTTP %s',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(KEY, { status }));
      const failure = await runGeminiDiagnostic(payload(), KEY, {
        fetcher,
      }).catch((error) => error);
      expect(failure).toBeInstanceOf(AIDiagnosticError);
      expect(failure.message).not.toContain(KEY);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  it('rejects malformed, safety-blocked, incomplete, and oversized provider output', async () => {
    const cases = [
      new Response('{invalid JSON'),
      Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
      Response.json({
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            content: { parts: [{ text: 'partial answer' }] },
          },
        ],
      }),
      Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'private thought', thought: true }] },
          },
        ],
      }),
      response(content({ summary: 'x'.repeat(AI_OUTPUT_LIMIT + 1) })),
      new Response('x'.repeat(97_000)),
    ];
    for (const candidate of cases) {
      await expect(
        runGeminiDiagnostic(payload(), KEY, {
          fetcher: vi.fn<typeof fetch>().mockResolvedValue(candidate),
        }),
      ).rejects.toBeInstanceOf(AIDiagnosticError);
    }
  });

  it('removes echoed API keys and sensitive strings from generated analysis', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        content({
          summary: `${KEY}\napiKey=private-output-token\nReview this hypothesis.`,
        }),
      ),
    );
    const output = await runGeminiDiagnostic(payload(), KEY, { fetcher });
    expect(JSON.stringify(output)).not.toContain(KEY);
    expect(JSON.stringify(output)).not.toContain('private-output-token');
    expect(output.summary).toContain('Review this hypothesis.');
  });

  it('rejects invalid payloads without fetching', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(runGeminiDiagnostic('', KEY, { fetcher })).rejects.toThrow(
      /payload/,
    );
    await expect(
      runGeminiDiagnostic('x'.repeat(AI_INPUT_LIMIT + 1), KEY, { fetcher }),
    ).rejects.toThrow(/payload|evidence/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('handles explicit cancellation before sending and while waiting', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      runGeminiDiagnostic(payload(), KEY, {
        fetcher,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/);
    expect(fetcher).not.toHaveBeenCalled();
    const pendingController = new AbortController();
    fetcher.mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const pending = runGeminiDiagnostic(payload(), KEY, {
      fetcher,
      signal: pendingController.signal,
    });
    const rejected = expect(pending).rejects.toThrow(/cancelled/);
    pendingController.abort();
    await rejected;
  });

  it('times out once without retrying and hides lower-level error strings', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new Error(KEY)),
            { once: true },
          );
        }),
    );
    const pending = runGeminiDiagnostic(payload(), KEY, {
      fetcher,
      timeoutMs: 50,
    });
    const rejected = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(
      runGeminiDiagnostic(payload(), KEY, {
        fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error(KEY)),
      }),
    ).rejects.toThrow(/Could not reach Gemini/);
  });
});
