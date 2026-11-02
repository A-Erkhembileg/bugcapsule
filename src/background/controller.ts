import { z } from 'zod';
import {
  createEmptyState,
  createReport,
  environmentSchema,
  MAX_EVENTS,
  normalizeEvent,
  reportSchema,
  sanitizedReport,
  stateSchema,
} from '../core';
import type { CaptureState } from '../shared/types';
import { bridgeIsActive, installBridge, stopBridge } from '../content/bridge';
import {
  installInstrumentation,
  stopInstrumentation,
} from '../page/instrumentation';
import { captureScreenshot } from './screenshot';
import type { Report } from '../shared/types';
import type { AiDiagnosticResult } from '../ai/schema';
import { restorePortableReport } from '../core/import';

function diagnosticContext(report: Report) {
  return JSON.stringify({
    ...report,
    aiDiagnostic: undefined,
    privacyReviewed: false,
  });
}

const DURATION = 15 * 60 * 1000;
const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GET_STATE') }).strict(),
  z
    .object({
      type: z.literal('START_CAPTURE'),
      timelineEnabled: z.boolean(),
      replaceReportId: z.string().max(80).optional(),
    })
    .strict(),
  z.object({ type: z.literal('STOP_CAPTURE') }).strict(),
  z.object({ type: z.literal('TAKE_SCREENSHOT') }).strict(),
  z.object({ type: z.literal('UPDATE_REPORT'), report: reportSchema }).strict(),
  z.object({ type: z.literal('DELETE_ALL') }).strict(),
  z
    .object({
      type: z.literal('IMPORT_REPORT'),
      report: reportSchema,
      replaceReportId: z.string().max(80).optional(),
    })
    .strict(),
]);
const eventEnvelope = z
  .object({
    type: z.literal('CAPTURE_EVENT'),
    channel: z.string().max(80),
    event: z.unknown(),
  })
  .strict();

/** All mutations, including tab events and worker wakeups, run through one queue. */
export class CaptureController {
  private state: CaptureState = createEmptyState();
  private channel: string | null = null;
  private documentId: string | null = null;
  private ready = false;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private expiry: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly api: typeof chrome = chrome) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    this.pending++;
    const next = this.queue.then(operation);
    this.queue = next
      .catch(() => undefined)
      .finally(() => {
        this.pending--;
      });
    return next;
  }

  private async initialize() {
    if (this.ready) return;
    await this.api.storage.session.setAccessLevel({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    const saved = await this.api.storage.session.get([
      'capture',
      'channel',
      'documentId',
    ]);
    const parsed = stateSchema.safeParse(saved.capture);
    this.state = parsed.success ? parsed.data : createEmptyState();
    this.channel = typeof saved.channel === 'string' ? saved.channel : null;
    this.documentId =
      typeof saved.documentId === 'string' ? saved.documentId : null;
    this.ready = true;
    if (!this.state.active) return;
    if (this.expired()) {
      await this.stop('Capture automatically stopped after 15 minutes.');
    } else if (await this.hasLiveBridge()) {
      this.scheduleExpiry();
    } else {
      await this.stop(
        'The original page is no longer collecting. Your saved report is ready to review.',
      );
    }
  }

  private expired() {
    return (
      this.state.startedAt === null ||
      Date.now() >= this.state.startedAt + DURATION
    );
  }

  private async hasLiveBridge() {
    if (!this.channel || !this.documentId || this.state.tabId === null)
      return false;
    const results = await this.api.scripting
      .executeScript({
        target: { tabId: this.state.tabId, documentIds: [this.documentId] },
        world: 'ISOLATED',
        func: bridgeIsActive,
        args: [this.channel],
      })
      .catch(() => []);
    return results[0]?.result === true;
  }

  private scheduleExpiry() {
    clearTimeout(this.expiry);
    if (this.state.startedAt === null) return;
    const channel = this.channel;
    this.expiry = setTimeout(
      () => {
        void this.serialize(async () => {
          if (channel === this.channel && this.state.active)
            await this.stop('Capture automatically stopped after 15 minutes.');
        }).catch(() => undefined);
      },
      Math.max(0, this.state.startedAt + DURATION - Date.now()),
    );
  }

  /** Commit storage first: failed writes cannot make an unsaved draft appear saved. */
  private async save(
    next: CaptureState,
    channel = this.channel,
    documentId = this.documentId,
  ) {
    await this.api.storage.session.set({ capture: next, channel, documentId });
    this.state = next;
    this.channel = channel;
    this.documentId = documentId;
  }

  private async badge(active: boolean) {
    await this.api.action.setBadgeBackgroundColor({ color: '#7158ed' });
    await this.api.action.setBadgeText({ text: active ? 'REC' : '' });
    await this.api.action.setTitle({
      title: active
        ? 'BugCapsule — capture active'
        : 'BugCapsule — capture a bug',
    });
  }

  private async detach(
    tabId: number | null,
    documentId: string | null,
    channel: string | null,
  ) {
    if (tabId === null || !channel) return;
    const target = documentId
      ? { tabId, documentIds: [documentId] }
      : { tabId, frameIds: [0] };
    await Promise.allSettled([
      this.api.scripting.executeScript({
        target,
        world: 'MAIN',
        func: stopInstrumentation,
        args: [channel],
      }),
      this.api.scripting.executeScript({
        target,
        world: 'ISOLATED',
        func: stopBridge,
        args: [channel],
      }),
    ]);
  }

  private async stop(notice: string | null = null) {
    const { channel, documentId } = this;
    // Deactivate before cleanup or persistence. Stopping must work even at storage quota.
    this.channel = null;
    this.state = { ...this.state, active: false, notice };
    clearTimeout(this.expiry);
    await this.detach(this.state.tabId, documentId, channel);
    await this.badge(false);
    try {
      await this.save(this.state);
    } catch {
      await this.api.storage.session.remove('channel').catch(() => undefined);
      throw new Error(
        'Collection stopped, but the status could not be saved. Retry Stop or delete the capture.',
      );
    }
  }

  private async start(timelineEnabled: boolean, replaceReportId?: string) {
    if (this.state.active)
      throw new Error(
        'Capture is already active. Stop it before starting again.',
      );
    if (this.state.report?.id !== replaceReportId)
      throw new Error(
        'Review the current report and confirm its replacement before starting another capture.',
      );
    const [tab] = await this.api.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      throw new Error(
        'Open an HTTP or HTTPS webpage, then click the BugCapsule toolbar button to grant access. Browser settings and extension pages cannot be captured.',
      );
    }
    const channel = crypto.randomUUID();
    const startedAt = Date.now();
    let documentId: string | null = null;
    try {
      const [bridge] = await this.api.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        world: 'ISOLATED',
        func: installBridge,
        args: [channel, timelineEnabled, startedAt + DURATION],
      });
      if (bridge?.frameId !== 0 || !bridge.documentId)
        throw new Error('Page is unavailable.');
      documentId = bridge.documentId;
      const environment = environmentSchema.parse(bridge.result);
      const [instrumentation] = await this.api.scripting.executeScript({
        target: { tabId: tab.id, documentIds: [documentId] },
        world: 'MAIN',
        func: installInstrumentation,
        args: [channel, startedAt + DURATION],
      });
      if (instrumentation?.result !== true)
        throw new Error('Page instrumentation is unavailable.');
      await this.badge(true);
      await this.save(
        {
          report: createReport(environment, startedAt),
          active: true,
          tabId: tab.id,
          startedAt,
          timelineEnabled,
          notice: null,
          droppedEvents: 0,
        },
        channel,
        documentId,
      );
      this.scheduleExpiry();
    } catch {
      // Replacement is atomic: leave the previous report and target untouched.
      await this.detach(tab.id, documentId, channel);
      await this.badge(false).catch(() => undefined);
      throw new Error(
        'Capture could not start. Check page access and available session storage, then retry from the webpage toolbar.',
      );
    }
  }

  private async updateReport(input: z.infer<typeof reportSchema>) {
    if (this.state.active)
      throw new Error('Stop capture before editing the report.');
    if (!this.state.report || this.state.report.id !== input.id)
      throw new Error(
        'This report is no longer available. Refresh the editor.',
      );
    const before = { ...this.state.report, privacyReviewed: false };
    const after = sanitizedReport(input);
    if (diagnosticContext(this.state.report) !== diagnosticContext(after))
      delete after.aiDiagnostic;
    if (
      JSON.stringify(before) !==
      JSON.stringify({ ...after, privacyReviewed: false })
    )
      after.privacyReviewed = false;
    await this.save({ ...this.state, report: after, notice: null });
  }

  private async deleteAll() {
    // Clearing storage does not require a write of the old, possibly oversized report.
    const { channel, documentId } = this;
    this.channel = null;
    this.state = { ...this.state, active: false };
    clearTimeout(this.expiry);
    await this.detach(this.state.tabId, documentId, channel);
    await this.badge(false);
    await this.api.storage.local.clear();
    await this.api.storage.session.clear();
    this.state = createEmptyState();
    this.documentId = null;
  }

  handle(message: unknown, sender: chrome.runtime.MessageSender) {
    // Browser-supplied sender URL allows both the popup and full editor tab.
    if (
      sender.id !== this.api.runtime.id ||
      sender.url?.split(/[?#]/, 1)[0] !==
        this.api.runtime.getURL('index.html') ||
      (sender.frameId !== undefined && sender.frameId !== 0)
    ) {
      return Promise.resolve({
        ok: false as const,
        error: 'Only BugCapsule pages can control capture.',
      });
    }
    const parsed = commandSchema.safeParse(message);
    if (!parsed.success)
      return Promise.resolve({
        ok: false as const,
        error: 'Invalid request or report. Check field sizes and try again.',
      });
    return this.serialize(async () => {
      try {
        await this.initialize();
        if (this.state.active && this.expired())
          await this.stop('Capture automatically stopped after 15 minutes.');
        const command = parsed.data;
        switch (command.type) {
          case 'START_CAPTURE':
            await this.start(command.timelineEnabled, command.replaceReportId);
            break;
          case 'STOP_CAPTURE':
            await this.stop();
            break;
          case 'TAKE_SCREENSHOT': {
            if (
              !this.state.report ||
              this.state.tabId === null ||
              !this.documentId
            )
              throw new Error(
                'Start a capture on the original page before taking a screenshot.',
              );
            const screenshot = await captureScreenshot(
              this.api,
              this.state.tabId,
              this.documentId,
            );
            await this.save({
              ...this.state,
              report: {
                ...this.state.report,
                screenshot,
                privacyReviewed: false,
              },
            });
            break;
          }
          case 'UPDATE_REPORT':
            await this.updateReport(command.report);
            break;
          case 'IMPORT_REPORT': {
            if (this.state.active)
              throw new Error('Stop capture before importing a report.');
            if (this.state.report?.id !== command.replaceReportId)
              throw new Error(
                'Confirm replacement of the current report before importing.',
              );
            const report = restorePortableReport(command.report);
            await this.save({ ...createEmptyState(), report });
            this.documentId = null;
            break;
          }
          case 'DELETE_ALL':
            await this.deleteAll();
            break;
          case 'GET_STATE':
            break;
        }
        return { ok: true as const, state: structuredClone(this.state) };
      } catch (error) {
        return {
          ok: false as const,
          error:
            error instanceof Error
              ? error.message
              : 'The operation failed. Please retry.',
        };
      }
    });
  }

  receiveEvent(message: unknown, sender: chrome.runtime.MessageSender) {
    if (
      this.pending > 220 ||
      sender.id !== this.api.runtime.id ||
      sender.frameId !== 0 ||
      !sender.documentId ||
      sender.tab?.id === undefined
    )
      return Promise.resolve();
    const envelope = eventEnvelope.safeParse(message);
    if (!envelope.success) return Promise.resolve();
    return this.serialize(async () => {
      await this.initialize();
      const { report, startedAt, active, tabId } = this.state;
      if (
        !active ||
        !report ||
        startedAt === null ||
        tabId !== sender.tab?.id ||
        sender.documentId !== this.documentId ||
        envelope.data.channel !== this.channel
      )
        return;
      if (this.expired()) {
        await this.stop('Capture automatically stopped after 15 minutes.');
        return;
      }
      if (report.events.length >= MAX_EVENTS) {
        await this.stop('Capture stopped at the 200-event limit.');
        return;
      }
      const event = normalizeEvent(envelope.data.event, startedAt);
      if (
        !event ||
        (!this.state.timelineEnabled &&
          (event.kind === 'click' || event.kind === 'navigation'))
      )
        return;
      const events = [...report.events, event];
      try {
        await this.save({
          ...this.state,
          report: { ...report, events, privacyReviewed: false },
        });
      } catch {
        await this.stop(
          'Capture stopped because session storage is unavailable.',
        );
        return;
      }
      if (events.length === MAX_EVENTS)
        await this.stop('Capture stopped at the 200-event limit.');
    }).catch(() => undefined);
  }

  tabEnded(tabId: number) {
    return this.serialize(async () => {
      await this.initialize();
      if (this.state.active && this.state.tabId === tabId) {
        await this.stop(
          'Capture stopped because the page navigated or the tab closed. Start a new capture for the next document.',
        );
      }
    }).catch(() => undefined);
  }

  reportForAI(reportId: string): Promise<Report> {
    return this.serialize(async () => {
      await this.initialize();
      if (this.state.active)
        throw new Error(
          'Stop capture and save your report before running AI diagnostics.',
        );
      if (!this.state.report || this.state.report.id !== reportId)
        throw new Error(
          'This report is no longer available. Open the current report and review it again.',
        );
      return structuredClone(this.state.report);
    });
  }

  saveAIDiagnostic(
    expected: Report,
    analysis: string | AiDiagnosticResult,
    signal?: AbortSignal,
  ): Promise<CaptureState> {
    return this.serialize(async () => {
      await this.initialize();
      if (signal?.aborted)
        throw new Error('AI diagnostic cancelled. The result was discarded.');
      if (
        this.state.active ||
        !this.state.report ||
        diagnosticContext(this.state.report) !== diagnosticContext(expected)
      ) {
        throw new Error(
          'The report changed while AI was analyzing it. The result was discarded. Save and review the current report before retrying.',
        );
      }
      const report = sanitizedReport({
        ...this.state.report,
        schemaVersion: '1.2.0',
        aiDiagnostic: analysis,
        privacyReviewed: false,
      });
      const previous = this.state;
      await this.save({ ...this.state, report });
      if (signal?.aborted) {
        await this.save(previous);
        throw new Error('AI diagnostic cancelled. The result was discarded.');
      }
      return structuredClone(this.state);
    });
  }
}
