import type { CaptureState, Report } from '../shared/types';
import type { AiModel } from '../ai/schema';

export type Request =
  | { type: 'GET_STATE' | 'STOP_CAPTURE' | 'TAKE_SCREENSHOT' | 'DELETE_ALL' }
  | {
      type: 'START_CAPTURE';
      timelineEnabled: boolean;
      replaceReportId?: string;
    }
  | { type: 'UPDATE_REPORT'; report: Report }
  | { type: 'IMPORT_REPORT'; report: Report; replaceReportId?: string };

export interface AIStatus {
  settings: { hasKey: boolean; remembered: boolean };
  running: boolean;
  model: string;
  configuration: { model: AiModel; allowRetries: boolean };
  lastError?: string;
  pending?: {
    reportId: string;
    status: 'running' | 'interrupted';
    startedAt: number;
  };
}

export interface PreparedDiagnostic {
  payload: string;
  fingerprint: string;
  model: string;
  promptVersion: string;
  maxAttempts: number;
}

type AIRequest =
  | { type: 'GET_AI_STATUS' | 'REMOVE_AI_KEY' | 'CANCEL_AI_DIAGNOSTIC' }
  | { type: 'SET_AI_KEY'; apiKey: string; remember: boolean }
  | { type: 'SET_AI_CONFIG'; model: AiModel; allowRetries: boolean }
  | { type: 'PREPARE_AI_DIAGNOSTIC'; reportId: string }
  | {
      type: 'RUN_AI_DIAGNOSTIC';
      reportId: string;
      fingerprint: string;
      consent: true;
    };

export async function aiRequest<T>(message: AIRequest): Promise<T> {
  if (!globalThis.chrome?.runtime?.id) {
    throw new Error('Open ReproQuill from the installed browser extension.');
  }
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (!response || typeof response !== 'object' || !('ok' in response)) {
    throw new Error(
      'The AI service did not respond. Reload the extension and try again.',
    );
  }
  if (response.ok !== true) {
    const message =
      'error' in response && typeof response.error === 'string'
        ? response.error
        : 'The AI request could not be completed.';
    const retry =
      'retryAfterSeconds' in response &&
      typeof response.retryAfterSeconds === 'number'
        ? ` Wait at least ${Math.ceil(response.retryAfterSeconds)} seconds before trying again.`
        : '';
    throw new Error(message + retry);
  }
  return response as T;
}

export async function request(message: Request): Promise<CaptureState> {
  if (!globalThis.chrome?.runtime?.id) {
    throw new Error(
      'Open ReproQuill from the installed browser extension. This editor requires Chrome extension APIs.',
    );
  }
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (!response || typeof response !== 'object' || !('ok' in response)) {
    throw new Error(
      'The extension did not respond. Reload the extension and try again.',
    );
  }
  if (response.ok !== true) {
    throw new Error(
      'error' in response && typeof response.error === 'string'
        ? response.error
        : 'The operation could not be completed.',
    );
  }
  if (!('state' in response))
    throw new Error('The extension returned an incomplete response.');
  return response.state as CaptureState;
}

export function download(
  filename: string,
  content: string | Uint8Array,
  type: string,
) {
  const bytes = typeof content === 'string' ? content : new Uint8Array(content);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
