import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AICoordinator,
  type AIReportStore,
} from '../../src/services/aiCoordinator';
import {
  AIDiagnosticError,
  GEMINI_ORIGIN,
  runGeminiDiagnostic,
} from '../../src/services/aiDiagnostic';
import { createEmptyState, createReport } from '../../src/core';
import type { CaptureState, Report } from '../../src/shared/types';
import { finalizeDiagnostic } from '../../src/ai/schema';
import type { AiDiagnosticResult } from '../../src/ai/schema';

const ID = 'a'.repeat(32);
const KEY = 'test-key-not-a-real-credential';
const sender = {
  id: ID,
  url: `chrome-extension://${ID}/index.html?view=full`,
  frameId: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function result(
  summary = 'A missing identifier may cause this error.',
): AiDiagnosticResult {
  return finalizeDiagnostic(
    {
      summary,
      observations: [],
      hypotheses: [],
      recommendedDebuggingSteps: [
        'Inspect the handler and add a focused reproduction test.',
      ],
      missingEvidence: ['Source code is not supplied.'],
      limitations: ['Synthetic test output is not a verified diagnosis.'],
    },
    { reportId: 'ai-report', model: 'gemini-3.5-flash-lite', evidenceIds: [] },
  );
}

function fixture() {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys == null) return structuredClone(data);
      const selected = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(selected.map((key) => [key, data[key]]));
    }),
    set: vi.fn(async (value: Record<string, unknown>) => {
      Object.assign(data, value);
    }),
    remove: vi.fn(async (key: string) => {
      delete data[key];
    }),
    setAccessLevel: vi.fn(async () => {}),
  });
  const api = {
    runtime: {
      id: ID,
      getURL: (file: string) => `chrome-extension://${ID}/${file}`,
    },
    permissions: { contains: vi.fn(async () => true) },
    storage: { local: area(local), session: area(session) },
  };
  let report: Report | null = createReport(
    {
      url: 'https://demo.test/',
      browser: 'Chromium test',
      viewport: { width: 800, height: 600, devicePixelRatio: 1 },
      language: 'en',
    },
    Date.now(),
    'ai-report',
  );
  report.privacyReviewed = true;
  const reports: AIReportStore = {
    reportForAI: vi.fn(async (id) => {
      if (!report || id !== report.id)
        throw new Error('This report is unavailable.');
      return structuredClone(report);
    }),
    saveAIDiagnostic: vi.fn(async (expected, analysis) => {
      if (!report || JSON.stringify(expected) !== JSON.stringify(report))
        throw new Error('The report changed while the diagnostic was running.');
      report = {
        ...report,
        schemaVersion: '1.2.0',
        aiDiagnostic: analysis,
        privacyReviewed: false,
      };
      return { ...createEmptyState(), report } satisfies CaptureState;
    }),
  };
  const diagnose = vi
    .fn<typeof runGeminiDiagnostic>()
    .mockResolvedValue(result());
  const coordinator = new AICoordinator(
    reports,
    api as unknown as typeof chrome,
    diagnose,
  );
  const request = (message: unknown, from = sender) =>
    coordinator.handle(message, from);
  const prepare = async () => {
    const reply = await request({
      type: 'PREPARE_AI_DIAGNOSTIC',
      reportId: 'ai-report',
    });
    if (!reply.ok || !('fingerprint' in reply))
      throw new Error('Preparation failed.');
    return {
      type: 'RUN_AI_DIAGNOSTIC',
      reportId: 'ai-report',
      fingerprint: reply.fingerprint,
      consent: true,
    };
  };
  const setKey = (remember = false) =>
    request({ type: 'SET_AI_KEY', apiKey: KEY, remember });
  return {
    api,
    coordinator,
    reports,
    diagnose,
    request,
    prepare,
    setKey,
    session,
    local,
    current: () => report,
    setReport: (value: Report | null) => {
      report = value;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AI coordinator consent and lifecycle', () => {
  it('exposes explicit default configuration and binds consent to the selected model and retry policy', async () => {
    const f = fixture();
    expect(await f.request({ type: 'GET_AI_STATUS' })).toMatchObject({
      configuration: { model: 'gemini-3.5-flash-lite', allowRetries: false },
    });
    await f.setKey();
    const oldConsent = await f.prepare();
    expect(
      (
        await f.request({
          type: 'SET_AI_CONFIG',
          model: 'gemini-3.8-flash',
          allowRetries: true,
        })
      ).ok,
    ).toBe(true);
    const stale = await f.request(oldConsent);
    expect(stale.ok).toBe(false);
    expect(f.diagnose).not.toHaveBeenCalled();
    const prepared = await f.request({
      type: 'PREPARE_AI_DIAGNOSTIC',
      reportId: 'ai-report',
    });
    expect(prepared).toMatchObject({
      ok: true,
      model: 'gemini-3.8-flash',
      promptVersion: '2.0.0',
      maxAttempts: 3,
    });
    f.diagnose.mockResolvedValueOnce({
      ...result(),
      model: 'gemini-3.8-flash',
    });
    expect((await f.request(await f.prepare())).ok).toBe(true);
    expect(f.diagnose.mock.calls[0]?.[2]).toMatchObject({
      model: 'gemini-3.8-flash',
      maxRetries: 2,
    });
  });

  it('rejects invalid saved configuration and allows an explicit supported replacement', async () => {
    const f = fixture();
    f.local.bugcapsuleAIConfiguration = {
      model: 'obsolete-or-paid-fallback',
      allowRetries: true,
    };
    const status = await f.request({ type: 'GET_AI_STATUS' });
    expect(status.ok).toBe(false);
    expect(
      (
        await f.request({
          type: 'PREPARE_AI_DIAGNOSTIC',
          reportId: 'ai-report',
        })
      ).ok,
    ).toBe(false);
    expect(f.diagnose).not.toHaveBeenCalled();
    expect(
      (
        await f.request({
          type: 'SET_AI_CONFIG',
          model: 'not-allowed',
          allowRetries: false,
        })
      ).ok,
    ).toBe(false);
    expect(
      await f.request({
        type: 'SET_AI_CONFIG',
        model: 'gemini-3.5-flash-lite',
        allowRetries: false,
      }),
    ).toMatchObject({
      ok: true,
      configuration: { model: 'gemini-3.5-flash-lite', allowRetries: false },
    });
  });

  it('records minimal pending metadata and safely fails interrupted jobs after a worker restart without resending', async () => {
    const f = fixture();
    await f.setKey();
    const provider = deferred<AiDiagnosticResult>();
    f.diagnose.mockReturnValueOnce(provider.promise);
    const pending = f.request(await f.prepare());
    await vi.waitFor(() => expect(f.diagnose).toHaveBeenCalledOnce());
    expect(f.session.bugcapsuleAIPending).toMatchObject({
      reportId: 'ai-report',
      model: 'gemini-3.5-flash-lite',
      status: 'running',
    });
    expect(JSON.stringify(f.session.bugcapsuleAIPending)).not.toContain(KEY);
    expect(f.session.bugcapsuleAIPending).not.toHaveProperty('payload');
    const replacement = new AICoordinator(
      f.reports,
      f.api as unknown as typeof chrome,
      f.diagnose,
    );
    expect(
      await replacement.handle({ type: 'GET_AI_STATUS' }, sender),
    ).toMatchObject({
      ok: true,
      running: false,
      pending: { status: 'interrupted', reportId: 'ai-report' },
      lastError: expect.stringContaining('not resent'),
    });
    expect(f.diagnose).toHaveBeenCalledOnce();
    f.coordinator.cancel();
    provider.resolve(result());
    expect((await pending).ok).toBe(false);
    expect(f.reports.saveAIDiagnostic).not.toHaveBeenCalled();
  });

  it('rejects page/subframe/foreign commands and missing per-request consent', async () => {
    const f = fixture();
    for (const from of [
      { ...sender, id: 'other' },
      { ...sender, frameId: 2 },
      { ...sender, url: 'https://demo.test/' },
      { ...sender, url: sender.url.replace('index.html', 'index.html.evil') },
    ]) {
      expect(
        (
          await f.request(
            { type: 'SET_AI_KEY', apiKey: KEY, remember: true },
            from,
          )
        ).ok,
      ).toBe(false);
    }
    const run = await f.prepare();
    expect((await f.request({ ...run, consent: false })).ok).toBe(false);
    const withoutConsent: Record<string, unknown> = { ...run };
    delete withoutConsent.consent;
    expect((await f.request(withoutConsent)).ok).toBe(false);
    expect(f.diagnose).not.toHaveBeenCalled();
    expect(f.local).toEqual({});
    expect(f.session).toEqual({});
  });

  it('previews without sending, then requires a key, permission and exact current fingerprint', async () => {
    const f = fixture();
    const run = await f.prepare();
    expect(f.diagnose).not.toHaveBeenCalled();
    expect((await f.request(run)).ok).toBe(false);
    await f.setKey();
    f.api.permissions.contains.mockResolvedValueOnce(false);
    const denied = await f.request(run);
    expect(!denied.ok && denied.error).toContain('not granted');
    expect(f.api.permissions.contains).toHaveBeenCalledWith({
      origins: [GEMINI_ORIGIN],
    });
    f.setReport({ ...f.current()!, title: 'Changed after preview' });
    const changed = await f.request(run);
    expect(!changed.ok && changed.error).toContain('report changed');
    expect(f.diagnose).not.toHaveBeenCalled();
  });

  it('saves analysis through the report store, resets review and hides key material in status', async () => {
    const f = fixture();
    await f.setKey();
    const reply = await f.request(await f.prepare());
    expect(reply.ok).toBe(true);
    expect(f.current()?.aiDiagnostic).toMatchObject({
      summary: expect.stringContaining('missing identifier'),
      reportId: 'ai-report',
    });
    expect(f.current()?.privacyReviewed).toBe(false);
    expect(JSON.stringify(f.current())).not.toContain(KEY);
    const status = await f.request({ type: 'GET_AI_STATUS' });
    expect(status).toMatchObject({
      ok: true,
      settings: { hasKey: true, remembered: false },
      running: false,
    });
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it('allows one in-flight request and accepts cancellation while the provider waits', async () => {
    const f = fixture();
    await f.setKey();
    const run = await f.prepare();
    const pendingProvider = deferred<AiDiagnosticResult>();
    f.diagnose.mockReturnValueOnce(pendingProvider.promise);
    const pending = f.request(run);
    await vi.waitFor(() => expect(f.diagnose).toHaveBeenCalledOnce());
    expect(await f.request({ type: 'GET_AI_STATUS' })).toMatchObject({
      ok: true,
      running: true,
    });
    const second = await f.request(run);
    expect(!second.ok && second.error).toContain('already running');
    await f.request({ type: 'CANCEL_AI_DIAGNOSTIC' });
    expect(f.diagnose.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
    pendingProvider.resolve(result('This late output must be discarded.'));
    expect((await pending).ok).toBe(false);
    expect(f.current()?.aiDiagnostic).toBeUndefined();
    expect(f.reports.saveAIDiagnostic).not.toHaveBeenCalled();
  });

  it('rejects stale results after report editing without replacing the new report', async () => {
    const f = fixture();
    await f.setKey();
    const pendingProvider = deferred<AiDiagnosticResult>();
    f.diagnose.mockReturnValueOnce(pendingProvider.promise);
    const pending = f.request(await f.prepare());
    await vi.waitFor(() => expect(f.diagnose).toHaveBeenCalledOnce());
    f.setReport({ ...f.current()!, title: 'New current draft' });
    pendingProvider.resolve(result('Outdated result'));
    const reply = await pending;
    expect(!reply.ok && reply.error).toContain('report changed');
    expect(f.current()?.title).toBe('New current draft');
    expect(f.current()?.aiDiagnostic).toBeUndefined();
  });

  it('discards a pending result when delete-all cancels and removes its report', async () => {
    const f = fixture();
    await f.setKey();
    const pendingProvider = deferred<AiDiagnosticResult>();
    f.diagnose.mockReturnValueOnce(pendingProvider.promise);
    const pending = f.request(await f.prepare());
    await vi.waitFor(() => expect(f.diagnose).toHaveBeenCalledOnce());
    f.coordinator.cancel();
    f.setReport(null); // Background delete-all clears the real capture store.
    pendingProvider.resolve(result('Deleted report output'));
    expect((await pending).ok).toBe(false);
    expect(f.current()).toBeNull();
    expect(f.reports.saveAIDiagnostic).not.toHaveBeenCalled();
  });

  it('removes keys from both stores and cancels a running request before result persistence', async () => {
    const f = fixture();
    await f.setKey(true);
    const pendingProvider = deferred<AiDiagnosticResult>();
    f.diagnose.mockReturnValueOnce(pendingProvider.promise);
    const pending = f.request(await f.prepare());
    await vi.waitFor(() => expect(f.diagnose).toHaveBeenCalledOnce());
    const removed = await f.request({ type: 'REMOVE_AI_KEY' });
    expect(removed).toMatchObject({
      ok: true,
      settings: { hasKey: false, remembered: false },
    });
    expect(JSON.stringify(f.local)).not.toContain(KEY);
    expect(JSON.stringify(f.session)).not.toContain(KEY);
    pendingProvider.resolve(result('Canceled by key removal'));
    expect((await pending).ok).toBe(false);
    expect(f.current()?.aiDiagnostic).toBeUndefined();
  });

  it('serializes overlapping key changes so the last retention choice wins', async () => {
    const f = fixture();
    const firstRemoval = deferred<void>();
    f.api.storage.session.remove.mockImplementationOnce(async (key) => {
      await firstRemoval.promise;
      delete f.session[key];
    });
    const first = f.request({
      type: 'SET_AI_KEY',
      apiKey: 'first-remembered-test-key',
      remember: true,
    });
    await vi.waitFor(() =>
      expect(f.api.storage.session.remove).toHaveBeenCalledOnce(),
    );
    const second = f.request({
      type: 'SET_AI_KEY',
      apiKey: 'second-session-test-key',
      remember: false,
    });
    // Let any unqueued storage operations progress before releasing the first mutation.
    for (let index = 0; index < 12; index++) await Promise.resolve();
    firstRemoval.resolve();
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(f.local).toEqual({});
    expect(Object.values(f.session)).toContain('second-session-test-key');
    expect(await f.request({ type: 'GET_AI_STATUS' })).toMatchObject({
      settings: { hasKey: true, remembered: false },
    });
  });

  it('persists a provider quota delay across worker-coordinator replacement without auto retries', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.setKey();
    f.diagnose.mockRejectedValueOnce(
      new AIDiagnosticError('Quota exceeded. Retry manually.', 120),
    );
    const run = await f.prepare();
    const first = await f.request(run);
    expect(first).toMatchObject({ ok: false, retryAfterSeconds: 120 });
    const restarted = new AICoordinator(
      f.reports,
      f.api as unknown as typeof chrome,
      f.diagnose,
    );
    const blocked = await restarted.handle(run, sender);
    expect(blocked).toMatchObject({ ok: false, retryAfterSeconds: 120 });
    expect(f.diagnose).toHaveBeenCalledOnce();
    vi.setSystemTime(Date.now() + 121_000);
    expect((await restarted.handle(run, sender)).ok).toBe(true);
    expect(f.diagnose).toHaveBeenCalledTimes(2);
  });

  it('waits for pending key writes during delete-all and prevents key resurrection', async () => {
    const f = fixture();
    const writing = deferred<void>();
    f.api.storage.local.set.mockImplementationOnce(async (value) => {
      await writing.promise;
      Object.assign(f.local, value);
    });
    const setting = f.setKey(true);
    await vi.waitFor(() =>
      expect(f.api.storage.local.set).toHaveBeenCalledOnce(),
    );
    const removeReport = vi.fn(async () => {
      f.setReport(null);
      return 'deleted';
    });
    const deleting = f.coordinator.deleteAll(removeReport);
    expect((await f.setKey(false)).ok).toBe(false);
    expect(removeReport).not.toHaveBeenCalled();
    writing.resolve();
    expect((await setting).ok).toBe(true);
    expect(await deleting).toBe('deleted');
    expect(f.local).toEqual({});
    expect(f.session).toEqual({});
    expect(f.current()).toBeNull();
  });
});
