import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureController } from '../../src/background/controller';
import { bridgeIsActive, installBridge, stopBridge } from '../../src/content/bridge';
import { installInstrumentation } from '../../src/page/instrumentation';
import type { CaptureState } from '../../src/shared/types';

// Small in-memory Chrome adapter; these tests exercise the real controller, schema,
// normalization, authorization, and queue. Playwright covers actual browser APIs.
const extensionId = 'a'.repeat(32);
const extensionUrl = 'chrome-extension://' + extensionId + '/index.html';
const uiSender = { id: extensionId, url: extensionUrl };
const tab: chrome.tabs.Tab = { id: 12, windowId: 1, url: 'https://demo.test/', active: true } as chrome.tabs.Tab;
const pageSender = { id: extensionId, tab, frameId: 0, documentId: 'document-a', url: tab.url };
const env = { url: 'https://demo.test/?token=test', browser: 'Chromium', viewport: { width: 800, height: 600, devicePixelRatio: 1 }, language: 'en' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WM6Li8AAAAASUVORK5CYII=';

function fixture() {
  const storage: Record<string, unknown> = {};
  let documentId = 'document-a';
  let bridgeActive = false;
  let active = tab;
  const execute = vi.fn(async (injection: { func: unknown }) => {
    let result: unknown = true;
    if (injection.func === installBridge) { result = env; bridgeActive = true; }
    if (injection.func === stopBridge) bridgeActive = false;
    if (injection.func === bridgeIsActive) result = bridgeActive;
    return [{ frameId: 0, documentId, result }];
  });
  const set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(storage, structuredClone(items)); });
  const localClear = vi.fn(async () => {});
  const captureVisibleTab = vi.fn(async () => png);
  const api = {
    runtime: { id: extensionId, getURL: (path: string) => 'chrome-extension://' + extensionId + '/' + path },
    tabs: {
      query: vi.fn(async () => [active]), captureVisibleTab,
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    scripting: { executeScript: execute },
    storage: {
      session: { get: async () => structuredClone(storage), set, remove: async (key: string) => { delete storage[key]; },
        clear: async () => { for (const key of Object.keys(storage)) delete storage[key]; },
        setAccessLevel: vi.fn(async () => {}) },
      local: { clear: localClear },
    },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}), setTitle: vi.fn(async () => {}) },
  };
  const controller = new CaptureController(api as unknown as typeof chrome);
  const request = (message: unknown, sender: chrome.runtime.MessageSender = uiSender) => controller.handle(message, sender);
  const state = async (): Promise<CaptureState> => {
    const reply = await request({ type: 'GET_STATE' });
    if (!reply.ok) throw new Error(reply.error);
    return reply.state;
  };
  const start = (timelineEnabled = false, replaceReportId?: string) => request({ type: 'START_CAPTURE', timelineEnabled, replaceReportId });
  const event = (raw: unknown, sender = pageSender, channel = storage.channel) =>
    controller.receiveEvent({ type: 'CAPTURE_EVENT', channel, event: raw }, sender);
  return { api, storage, controller, request, state, start, event, set, execute, captureVisibleTab,
    setDocument: (value: string) => { documentId = value; }, setActive: (value: chrome.tabs.Tab) => { active = value; } };
}

const diagnostic = { kind: 'error', message: 'failure token=not-for-report' };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('capture controller', () => {
  it('saves reviewable AI output and invalidates it when evidence changes', async () => {
    const f = fixture(); await f.start(); await f.request({ type: 'STOP_CAPTURE' });
    const report = (await f.state()).report!;
    const snapshot = await f.controller.reportForAI(report.id);
    const next = await f.controller.saveAIDiagnostic(snapshot, 'A hypothesis to verify.');
    expect(next.report?.aiDiagnostic).toBe('A hypothesis to verify.');
    expect(next.report?.privacyReviewed).toBe(false);
    await f.request({ type: 'UPDATE_REPORT', report: { ...next.report!, description: 'New evidence' } });
    expect((await f.state()).report?.aiDiagnostic).toBeUndefined();
    await expect(f.controller.saveAIDiagnostic(snapshot, 'Outdated result')).rejects.toThrow(/changed/);
  });

  it('discards cancelled analysis even if cancellation arrives during its storage write', async () => {
    const f = fixture(); await f.start(); await f.request({ type: 'STOP_CAPTURE' });
    const report = (await f.state()).report!;
    const cancellation = new AbortController();
    f.set.mockImplementationOnce(async (items: Record<string, unknown>) => {
      Object.assign(f.storage, structuredClone(items));
      cancellation.abort();
    });
    await expect(f.controller.saveAIDiagnostic(report, 'Discard this analysis', cancellation.signal)).rejects.toThrow(/cancelled/);
    expect((await f.state()).report?.aiDiagnostic).toBeUndefined();
    expect(JSON.stringify(f.storage)).not.toContain('Discard this analysis');
  });

  it('captures only after user initiation, detaches on stop, deletes and starts a new session', async () => {
    const f = fixture();
    await f.event(diagnostic);
    expect((await f.state()).report).toBeNull();
    expect(f.execute).not.toHaveBeenCalled();
    expect((await f.start()).ok).toBe(true);
    expect(f.api.action.setBadgeText).toHaveBeenCalledWith({ text: 'REC' });
    const oldChannel = f.storage.channel;
    await f.event(diagnostic);
    await f.request({ type: 'STOP_CAPTURE' });
    await f.event(diagnostic, pageSender, oldChannel);
    expect((await f.state()).report?.events).toHaveLength(1);
    expect(JSON.stringify(f.storage)).not.toContain('not-for-report');
    await f.request({ type: 'DELETE_ALL' });
    expect(f.storage).toEqual({});
    expect((await f.state()).report).toBeNull();
    expect((await f.start()).ok).toBe(true);
    expect(f.storage.channel).not.toBe(oldChannel);
    await f.event(diagnostic, pageSender, oldChannel);
    expect((await f.state()).report?.events).toHaveLength(0);
  });

  it('allows the full editor and rejects privileged commands from pages, subframes, and lookalike origins', async () => {
    const f = fixture();
    for (const sender of [pageSender, { ...uiSender, id: 'forged' }, { ...uiSender, frameId: 2 },
      { ...uiSender, url: extensionUrl + '.evil' }, { ...uiSender, url: 'chrome-extension://other/index.html' }]) {
      expect((await f.request({ type: 'START_CAPTURE', timelineEnabled: true }, sender)).ok).toBe(false);
    }
    expect(f.execute).not.toHaveBeenCalled();
    expect((await f.request({ type: 'GET_STATE' }, { ...uiSender, url: extensionUrl + '?view=full', tab, frameId: 0 })).ok).toBe(true);
  });

  it('validates event sender, frame, original document, channel, shape and timeline opt-in', async () => {
    const f = fixture();
    await f.start(false);
    for (const sender of [{ ...pageSender, id: 'other' }, { ...pageSender, frameId: 1 },
      { ...pageSender, documentId: 'navigated' }, { ...pageSender, tab: { ...tab, id: 13 } }]) {
      await f.event(diagnostic, sender);
    }
    await f.event(diagnostic, pageSender, 'wrong-channel');
    await f.event({ kind: 'error', message: { private: 'discard' } });
    await f.event({ kind: 'click', message: 'Clicked button' });
    expect((await f.state()).report?.events).toHaveLength(0);
    await Promise.all([f.event(diagnostic), f.event(diagnostic)]);
    expect((await f.state()).report?.events).toHaveLength(2);
  });

  it('keeps recording after a duplicate start, rejected edit, or denied screenshot', async () => {
    const f = fixture();
    await f.start();
    const report = (await f.state()).report;
    expect((await f.start()).ok).toBe(false);
    expect((await f.request({ type: 'UPDATE_REPORT', report })).ok).toBe(false);
    f.captureVisibleTab.mockRejectedValueOnce(new Error('access denied'));
    expect((await f.request({ type: 'TAKE_SCREENSHOT' })).ok).toBe(false);
    expect((await f.state()).active).toBe(true);
    expect((await f.state()).report?.screenshot).toBeUndefined();
  });

  it('preserves the stopped report when a replacement lacks approval or fails injection/storage', async () => {
    const f = fixture();
    await f.start(); await f.event(diagnostic); await f.request({ type: 'STOP_CAPTURE' });
    const previous = (await f.state()).report!;
    expect((await f.start()).ok).toBe(false);
    expect((await f.start(false, 'stale-id')).ok).toBe(false);
    const original = f.execute.getMockImplementation()!;
    f.execute.mockImplementation(async options => {
      if (options.func === installInstrumentation) throw new Error('permission denied');
      return original(options);
    });
    expect((await f.start(false, previous.id)).ok).toBe(false);
    expect((await f.state()).report).toEqual(previous);
    f.execute.mockImplementation(original);
    f.set.mockRejectedValueOnce(new Error('quota exceeded'));
    expect((await f.start(false, previous.id)).ok).toBe(false);
    expect((await f.state()).report).toEqual(previous);
    expect((await f.start(true, previous.id)).ok).toBe(true);
    expect((await f.state()).report?.id).not.toBe(previous.id);
    expect((await f.state()).timelineEnabled).toBe(true);
  });

  it('rejects privileged pages without injecting any code', async () => {
    const f = fixture(); f.setActive({ ...tab, url: 'chrome://settings' });
    expect((await f.start()).ok).toBe(false);
    expect(f.execute).not.toHaveBeenCalled();
    expect((await f.state()).active).toBe(false);
  });

  it('takes a screenshot from the original document and rejects changed tabs/documents, even after stop', async () => {
    const f = fixture(); await f.start(); await f.request({ type: 'STOP_CAPTURE' });
    expect((await f.request({ type: 'TAKE_SCREENSHOT' })).ok).toBe(true);
    expect((await f.state()).report?.screenshot).toMatchObject({ width: 1, height: 1, redacted: false });
    f.setActive({ ...tab, id: 22 }); expect((await f.request({ type: 'TAKE_SCREENSHOT' })).ok).toBe(false);
    f.setActive(tab); f.setDocument('navigated');
    expect((await f.request({ type: 'TAKE_SCREENSHOT' })).ok).toBe(false);
    expect(f.captureVisibleTab).toHaveBeenCalledTimes(1);
  });

  it('discards pixels when activation or navigation occurs during captureVisibleTab', async () => {
    const f = fixture(); await f.start();
    f.captureVisibleTab.mockImplementationOnce(async () => {
      const listener = f.api.tabs.onActivated.addListener.mock.lastCall?.[0];
      listener({ windowId: 1, tabId: 22 }); // Even a switch away and back is unsafe.
      listener({ windowId: 1, tabId: 12 });
      return png;
    });
    expect((await f.request({ type: 'TAKE_SCREENSHOT' })).ok).toBe(false);
    f.captureVisibleTab.mockImplementationOnce(async () => { f.setDocument('new-page'); return png; });
    expect((await f.request({ type: 'TAKE_SCREENSHOT' })).ok).toBe(false);
    expect((await f.state()).report?.screenshot).toBeUndefined();
    expect(f.api.tabs.onActivated.removeListener).toHaveBeenCalledTimes(2);
  });

  it('invalidates review on content edits or new screenshot and rolls back failed saves', async () => {
    const f = fixture(); await f.start(); await f.request({ type: 'STOP_CAPTURE' });
    const original = (await f.state()).report!;
    const update = (patch: object) => f.request({ type: 'UPDATE_REPORT', report: { ...original, ...patch } });
    await update({ title: 'Edited', privacyReviewed: true });
    expect((await f.state()).report?.privacyReviewed).toBe(false);
    await update({ title: 'Edited', privacyReviewed: true });
    expect((await f.state()).report?.privacyReviewed).toBe(true);
    f.set.mockRejectedValueOnce(new Error('disk unavailable'));
    expect((await update({ title: 'Unsaved' })).ok).toBe(false);
    expect((await f.state()).report?.title).toBe('Edited');
    await f.request({ type: 'TAKE_SCREENSHOT' });
    expect((await f.state()).report?.privacyReviewed).toBe(false);
    expect((await update({ title: 'x'.repeat(210) })).ok).toBe(false);
  });

  it('stops on target navigation, expiration after a worker restart, and failed event persistence', async () => {
    const f = fixture(); await f.start();
    await f.controller.tabEnded(99); expect((await f.state()).active).toBe(true);
    await f.controller.tabEnded(tab.id!); expect((await f.state()).active).toBe(false);
    const id = (await f.state()).report!.id;
    await f.start(true, id);
    f.set.mockRejectedValueOnce(new Error('quota exceeded'));
    await f.event(diagnostic);
    expect((await f.state()).active).toBe(false);
    expect((await f.state()).report?.events).toHaveLength(0);
    await f.start(true, (await f.state()).report!.id);
    vi.setSystemTime(Date.now() + 16 * 60_000);
    const restarted = new CaptureController(f.api as unknown as typeof chrome);
    const reply = await restarted.handle({ type: 'GET_STATE' }, uiSender);
    expect(reply.ok && reply.state.active).toBe(false);
    expect(reply.ok && reply.state.notice).toMatch(/15 minutes/);
  });
});
