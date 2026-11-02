import { z } from 'zod';
import type { CaptureState, Report } from '../shared/types';
import {
  AIDiagnosticError,
  buildDiagnosticPayload,
  diagnosticFingerprint,
  GEMINI_ORIGIN,
  GeminiKeyStore,
  runGeminiDiagnostic,
} from './aiDiagnostic';
import { AI_PROMPT_VERSION } from '../ai/prompt';
import {
  aiConfigurationSchema,
  DEFAULT_AI_CONFIGURATION,
} from './aiConfiguration';
import type { AIConfiguration } from './aiConfiguration';
import type { AiDiagnosticResult } from '../ai/schema';

const COOLDOWN_STORAGE = 'bugcapsuleAIRetryAfter';
const CONFIG_STORAGE = 'bugcapsuleAIConfiguration';
const PENDING_STORAGE = 'bugcapsuleAIPending';
const pendingSchema = z
  .object({
    requestId: z.string().max(80),
    reportId: z.string().max(80),
    model: z.string().max(80),
    startedAt: z.number().nonnegative(),
    status: z.enum(['running', 'interrupted']),
    attempt: z.number().int().min(0).max(3),
  })
  .strict();
const commands = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GET_AI_STATUS') }).strict(),
  z
    .object({
      type: z.literal('SET_AI_CONFIG'),
      ...aiConfigurationSchema.shape,
    })
    .strict(),
  z
    .object({
      type: z.literal('SET_AI_KEY'),
      apiKey: z.string().min(6).max(200),
      remember: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('REMOVE_AI_KEY') }).strict(),
  z
    .object({
      type: z.literal('PREPARE_AI_DIAGNOSTIC'),
      reportId: z.string().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal('RUN_AI_DIAGNOSTIC'),
      reportId: z.string().min(1).max(80),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      consent: z.literal(true),
    })
    .strict(),
  z.object({ type: z.literal('CANCEL_AI_DIAGNOSTIC') }).strict(),
]);

export const AI_COMMANDS = new Set([
  'GET_AI_STATUS',
  'SET_AI_CONFIG',
  'SET_AI_KEY',
  'REMOVE_AI_KEY',
  'PREPARE_AI_DIAGNOSTIC',
  'RUN_AI_DIAGNOSTIC',
  'CANCEL_AI_DIAGNOSTIC',
]);

export interface AIReportStore {
  reportForAI(reportId: string): Promise<Report>;
  saveAIDiagnostic(
    expected: Report,
    analysis: AiDiagnosticResult,
    signal?: AbortSignal,
  ): Promise<CaptureState>;
}

/** Keep network waits outside the capture queue, so Stop and Delete remain responsive. */
export class AICoordinator {
  private readonly keys: GeminiKeyStore;
  private job: { controller: AbortController; cancelled: boolean } | null =
    null;
  private lastError: string | undefined;
  private keyQueue: Promise<unknown> = Promise.resolve();
  private deleting = 0;
  private initialization: Promise<void> | undefined;

  initialize(): Promise<void> {
    if (!this.initialization)
      this.initialization = this.recover().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    return this.initialization;
  }

  private async recover() {
    await this.keys.status();
    const saved = await this.api.storage.session.get(PENDING_STORAGE);
    const pending = pendingSchema.safeParse(saved[PENDING_STORAGE]);
    if (pending.success && pending.data.status === 'running') {
      await this.api.storage.session.set({
        [PENDING_STORAGE]: { ...pending.data, status: 'interrupted' },
      });
      this.lastError =
        'The previous AI request was interrupted when the extension worker restarted. It was not resent. Review the evidence and run again when ready.';
    }
  }

  private async configuration(): Promise<AIConfiguration> {
    const stored = await this.api.storage.local.get(CONFIG_STORAGE);
    if (stored[CONFIG_STORAGE] === undefined)
      return { ...DEFAULT_AI_CONFIGURATION };
    const parsed = aiConfigurationSchema.safeParse(stored[CONFIG_STORAGE]);
    if (!parsed.success)
      throw new AIDiagnosticError(
        'Saved AI configuration is invalid. Select a supported model and save Settings again.',
      );
    return parsed.data;
  }

  private approvedFingerprint(payload: string, configuration: AIConfiguration) {
    return diagnosticFingerprint(
      JSON.stringify({
        payload,
        ...configuration,
        promptVersion: AI_PROMPT_VERSION,
      }),
    );
  }

  constructor(
    private readonly reports: AIReportStore,
    private readonly api: typeof chrome = chrome,
    private readonly diagnose: typeof runGeminiDiagnostic = runGeminiDiagnostic,
  ) {
    this.keys = new GeminiKeyStore(api);
  }

  cancel() {
    if (this.job) {
      this.job.cancelled = true;
      this.job.controller.abort();
    }
  }

  private mutateKeys<T>(action: () => Promise<T>): Promise<T> {
    const next = this.keyQueue.then(action);
    this.keyQueue = next.catch(() => undefined);
    return next;
  }

  /** Deletion waits for earlier key writes and prevents any later writes until it completes. */
  async deleteAll<T>(removeReport: () => Promise<T>): Promise<T> {
    this.deleting++;
    this.cancel();
    try {
      await this.initialize().catch(() => undefined);
      return await this.mutateKeys(async () => {
        await this.keys.clear();
        this.lastError = undefined;
        return removeReport();
      });
    } finally {
      this.deleting--;
    }
  }

  private async status() {
    await this.keyQueue;
    const configuration = await this.configuration();
    const saved = await this.api.storage.session.get(PENDING_STORAGE);
    const pending = pendingSchema.safeParse(saved[PENDING_STORAGE]);
    return {
      settings: await this.keys.status(),
      running: Boolean(this.job),
      model: configuration.model,
      configuration,
      ...(pending.success ? { pending: pending.data } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  private async prepare(reportId: string) {
    const configuration = await this.configuration();
    const payload = buildDiagnosticPayload(
      await this.reports.reportForAI(reportId),
    );
    return {
      payload,
      fingerprint: await this.approvedFingerprint(payload, configuration),
      model: configuration.model,
      promptVersion: AI_PROMPT_VERSION,
      maxAttempts: configuration.allowRetries ? 3 : 1,
    };
  }

  private async run(reportId: string, fingerprint: string) {
    if (this.job)
      throw new AIDiagnosticError(
        'An AI diagnostic is already running. Wait for it or cancel it first.',
      );
    // Set synchronously before the first await, preventing two simultaneous sends.
    const job = { controller: new AbortController(), cancelled: false };
    this.job = job;
    this.lastError = undefined;
    let pending: z.infer<typeof pendingSchema> | undefined;
    try {
      const configuration = await this.configuration();
      const report = await this.reports.reportForAI(reportId);
      const payload = buildDiagnosticPayload(report);
      if (
        (await this.approvedFingerprint(payload, configuration)) !== fingerprint
      )
        throw new AIDiagnosticError(
          'The report changed since the transmission preview. Review the new payload before sending.',
        );
      if (!(await this.api.permissions.contains({ origins: [GEMINI_ORIGIN] })))
        throw new AIDiagnosticError(
          'Google access was not granted. Your report has not been sent.',
        );
      const key = await this.keys.read();
      if (!key)
        throw new AIDiagnosticError(
          'Add your Gemini API key in Settings before running a diagnostic.',
        );
      const saved = await this.api.storage.session.get(COOLDOWN_STORAGE);
      const until = saved[COOLDOWN_STORAGE];
      if (typeof until === 'number' && until > Date.now()) {
        const seconds = Math.ceil((until - Date.now()) / 1000);
        throw new AIDiagnosticError(
          `Wait ${seconds} seconds before sending another AI request.`,
          seconds,
        );
      }
      if (job.cancelled)
        throw new AIDiagnosticError('AI diagnostic cancelled before sending.');
      // Recheck immediately before transmission in case a different editor changed/deleted it.
      const current = await this.reports.reportForAI(reportId);
      if (
        (await this.approvedFingerprint(
          buildDiagnosticPayload(current),
          await this.configuration(),
        )) !== fingerprint
      )
        throw new AIDiagnosticError(
          'The report changed before transmission. Review it again.',
        );
      if (job.cancelled)
        throw new AIDiagnosticError('AI diagnostic cancelled before sending.');
      await this.api.storage.session.set({
        [COOLDOWN_STORAGE]: Date.now() + 10_000,
      });
      pending = {
        requestId: crypto.randomUUID(),
        reportId,
        model: configuration.model,
        startedAt: Date.now(),
        status: 'running',
        attempt: 0,
      };
      await this.api.storage.session.set({ [PENDING_STORAGE]: pending });
      const analysis = await this.diagnose(payload, key, {
        signal: job.controller.signal,
        model: configuration.model,
        maxRetries: configuration.allowRetries ? 2 : 0,
        onAttempt: async (attempt) => {
          if (job.cancelled)
            throw new AIDiagnosticError(
              'AI diagnostic cancelled before sending.',
            );
          pending = { ...pending!, attempt };
          await this.api.storage.session.set({ [PENDING_STORAGE]: pending });
        },
      });
      if (job.cancelled)
        throw new AIDiagnosticError(
          'AI diagnostic cancelled. The result was discarded. Data already sent cannot be recalled from Google.',
        );
      const state = await this.reports.saveAIDiagnostic(
        current,
        analysis,
        job.controller.signal,
      );
      await this.api.storage.session
        .remove(PENDING_STORAGE)
        .catch(() => undefined);
      return { state };
    } catch (error) {
      if (pending && !job.cancelled && this.deleting === 0) {
        await this.api.storage.session
          .set({ [PENDING_STORAGE]: { ...pending, status: 'interrupted' } })
          .catch(() => undefined);
      }
      if (
        error instanceof AIDiagnosticError &&
        error.retryAfterSeconds !== undefined && !job.cancelled && this.deleting === 0
      ) {
        await this.api.storage.session
          .set({
            [COOLDOWN_STORAGE]: Date.now() + error.retryAfterSeconds * 1000,
          })
          .catch(() => undefined);
      }
      throw error;
    } finally {
      if (job.cancelled)
        await this.api.storage.session
          .remove(PENDING_STORAGE)
          .catch(() => undefined);
      if (this.job === job) this.job = null;
    }
  }

  async handle(message: unknown, sender: chrome.runtime.MessageSender) {
    if (
      sender.id !== this.api.runtime.id ||
      sender.url?.split(/[?#]/, 1)[0] !==
        this.api.runtime.getURL('index.html') ||
      (sender.frameId !== undefined && sender.frameId !== 0)
    ) {
      return {
        ok: false as const,
        error: 'Only BugCapsule pages can access AI settings and diagnostics.',
      };
    }
    const parsed = commands.safeParse(message);
    if (!parsed.success)
      return {
        ok: false as const,
        error:
          'Invalid AI request. Explicit consent and a current reviewed payload are required.',
      };
    try {
      await this.initialize();
      const command = parsed.data;
      if (
        this.deleting > 0 &&
        command.type !== 'GET_AI_STATUS' &&
        command.type !== 'CANCEL_AI_DIAGNOSTIC'
      ) {
        throw new AIDiagnosticError(
          'Data deletion is in progress. Wait for it to finish before changing AI settings.',
        );
      }
      switch (command.type) {
        case 'GET_AI_STATUS':
          return { ok: true as const, ...(await this.status()) };
        case 'SET_AI_CONFIG':
          this.cancel();
          await this.mutateKeys(() =>
            this.api.storage.local.set({
              [CONFIG_STORAGE]: {
                model: command.model,
                allowRetries: command.allowRetries,
              },
            }),
          );
          this.lastError = undefined;
          return { ok: true as const, ...(await this.status()) };
        case 'SET_AI_KEY':
          this.cancel();
          await this.mutateKeys(() =>
            this.keys.save(command.apiKey, command.remember),
          );
          this.lastError = undefined;
          return { ok: true as const, ...(await this.status()) };
        case 'REMOVE_AI_KEY':
          this.cancel();
          await this.mutateKeys(() => this.keys.clear());
          this.lastError = undefined;
          return { ok: true as const, ...(await this.status()) };
        case 'PREPARE_AI_DIAGNOSTIC':
          return {
            ok: true as const,
            ...(await this.prepare(command.reportId)),
          };
        case 'CANCEL_AI_DIAGNOSTIC':
          this.cancel();
          return { ok: true as const, ...(await this.status()) };
        case 'RUN_AI_DIAGNOSTIC':
          return {
            ok: true as const,
            ...(await this.run(command.reportId, command.fingerprint)),
          };
      }
    } catch (error) {
      const message =
        error instanceof AIDiagnosticError ||
        (error instanceof Error && /report|capture/i.test(error.message))
          ? error.message
          : 'AI settings or analysis could not be completed. Your report is unchanged. Please retry.';
      this.lastError = message;
      return {
        ok: false as const,
        error: message,
        ...(error instanceof AIDiagnosticError &&
        error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      };
    }
  }
}
