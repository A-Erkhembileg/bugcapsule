import {
  aiModelSchema,
  AI_RESPONSE_JSON_SCHEMA,
  finalizeDiagnostic,
  tokenUsageSchema,
} from '../ai/schema';
import type { AiDiagnosticResult, AiModel } from '../ai/schema';
import {
  AI_INPUT_LIMIT,
  evidenceIdsFromPayload,
  parseDiagnosticPayload,
} from '../ai/payload';
import { DIAGNOSTIC_SYSTEM_PROMPT } from '../ai/prompt';
import {
  AI_OUTPUT_LIMIT,
  GEMINI_MODEL,
  geminiEndpoint,
} from './aiConfiguration';
import { AIDiagnosticError } from './aiError';

const RESPONSE_LIMIT = 196_608;

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body)
    throw new AIDiagnosticError(
      'Gemini returned an empty response. Your report is unchanged.',
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT)
        throw new AIDiagnosticError(
          'Gemini returned an oversized response. Your report is unchanged.',
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AIDiagnosticError(
      'Gemini returned an invalid response. Your report is unchanged.',
    );
  }
}

function responseText(value: unknown): string {
  if (
    !value ||
    typeof value !== 'object' ||
    !('candidates' in value) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length !== 1
  )
    return '';
  const candidate: unknown = value.candidates[0];
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !('finishReason' in candidate) ||
    candidate.finishReason !== 'STOP' ||
    !('content' in candidate)
  )
    return '';
  const content = candidate.content;
  if (
    !content ||
    typeof content !== 'object' ||
    !('parts' in content) ||
    !Array.isArray(content.parts)
  )
    return '';
  return content.parts
    .filter((part: unknown): part is { text: string } =>
      Boolean(
        part &&
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string' &&
        !('thought' in part && part.thought === true),
      ),
    )
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function tokenUsage(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('usageMetadata' in value) ||
    !value.usageMetadata ||
    typeof value.usageMetadata !== 'object'
  )
    return undefined;
  const usage = value.usageMetadata as Record<string, unknown>;
  const integer = (v: unknown): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  const output = integer(usage.candidatesTokenCount)
    ? usage.candidatesTokenCount +
      (integer(usage.thoughtsTokenCount) ? usage.thoughtsTokenCount : 0)
    : undefined;
  const parsed = tokenUsageSchema.safeParse({
    ...(integer(usage.promptTokenCount)
      ? { inputTokens: usage.promptTokenCount }
      : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    ...(integer(usage.totalTokenCount)
      ? { totalTokens: usage.totalTokenCount }
      : {}),
  });
  return parsed.success && Object.keys(parsed.data).length
    ? parsed.data
    : undefined;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

function httpError(response: Response): AIDiagnosticError {
  if (response.status === 429) {
    const raw = response.headers.get('retry-after');
    const delay =
      raw && /^\d+$/.test(raw)
        ? Number(raw)
        : raw
          ? Math.ceil((Date.parse(raw) - Date.now()) / 1000)
          : 60;
    const seconds = Number.isFinite(delay)
      ? Math.min(86_400, Math.max(1, delay))
      : 60;
    return new AIDiagnosticError(
      `Gemini's quota or rate limit was reached. Wait ${seconds} seconds before retrying. Your report is unchanged.`,
      seconds,
      true,
    );
  }
  if (response.status === 401 || response.status === 403)
    return new AIDiagnosticError(
      'Gemini denied this key or project. Check its restrictions, eligibility and model access in Google AI Studio.',
    );
  if (response.status === 404)
    return new AIDiagnosticError(
      'The selected Gemini model is unavailable for your project. Select an available model explicitly in Settings.',
    );
  return new AIDiagnosticError(
    'Gemini could not complete the diagnostic. Your report is unchanged.',
    undefined,
    response.status === 408 || response.status >= 500,
  );
}

export interface DiagnosticOptions {
  model?: AiModel;
  maxRetries?: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  random?: () => number;
  retryDelay?: (ms: number, signal: AbortSignal) => Promise<void>;
  onAttempt?: (attempt: number) => void | Promise<void>;
}

/** The default is one request. Additional attempts require explicit caller policy. */
export async function runGeminiDiagnostic(
  payload: string,
  apiKey: string,
  options: DiagnosticOptions = {},
): Promise<AiDiagnosticResult> {
  let report: ReturnType<typeof parseDiagnosticPayload>;
  let model: AiModel;
  try {
    report = parseDiagnosticPayload(payload);
    model = aiModelSchema.parse(options.model ?? GEMINI_MODEL);
  } catch {
    throw new AIDiagnosticError(
      'Invalid diagnostic evidence or model configuration. Review the payload again.',
    );
  }
  if (!payload || payload.length > AI_INPUT_LIMIT)
    throw new AIDiagnosticError('Invalid or oversized diagnostic payload.');
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(apiKey))
    throw new AIDiagnosticError(
      'Add a valid Gemini API key in Settings before sending.',
    );
  const maxRetries = options.maxRetries ?? 0;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2)
    throw new AIDiagnosticError(
      'Invalid retry configuration. At most two retries are allowed.',
    );
  const started = Date.now();
  const timeout = Math.min(25_000, Math.max(1, options.timeoutMs ?? 25_000));
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  const responseSchema = { ...AI_RESPONSE_JSON_SCHEMA };
  delete responseSchema.$schema;
  try {
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      if (controller.signal.aborted)
        throw new DOMException('Aborted', 'AbortError');
      await options.onAttempt?.(attempt);
      if (controller.signal.aborted)
        throw new DOMException('Aborted', 'AbortError');
      let result: unknown;
      try {
        const response = await (options.fetcher ?? fetch)(
          geminiEndpoint(model),
          {
            method: 'POST',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: DIAGNOSTIC_SYSTEM_PROMPT }],
              },
              contents: [{ role: 'user', parts: [{ text: payload }] }],
              generationConfig: {
                candidateCount: 1,
                maxOutputTokens: 6_144,
                responseMimeType: 'application/json',
                responseJsonSchema: responseSchema,
              },
            }),
          },
        );
        if (!response.ok) {
          const failure = httpError(response);
          await response.body?.cancel().catch(() => undefined);
          throw failure;
        }
        result = await readResponse(response);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        const failure =
          error instanceof AIDiagnosticError
            ? error
            : new AIDiagnosticError(
                'Could not reach Gemini. Check your connection and Google access permission.',
                undefined,
                true,
              );
        if (!failure.retryable || attempt > maxRetries) throw failure;
        const exponential = 500 * 2 ** (attempt - 1);
        const backoff = Math.max(
          exponential +
            Math.floor(
              Math.max(0, Math.min(1, (options.random ?? Math.random)())) *
                exponential,
            ),
          (failure.retryAfterSeconds ?? 0) * 1000,
        );
        if (Date.now() - started + backoff >= timeout) throw failure;
        await (options.retryDelay ?? delay)(backoff, controller.signal);
        continue;
      }
      const text = responseText(result);
      if (!text || text.length > AI_OUTPUT_LIMIT)
        throw new AIDiagnosticError(
          'Gemini returned blocked, incomplete, empty or oversized analysis. Your report is unchanged.',
        );
      try {
        const content: unknown = JSON.parse(
          text.split(apiKey).join('[REDACTED API key]'),
        );
        return finalizeDiagnostic(content, {
          reportId: report.reportId,
          model,
          evidenceIds: evidenceIdsFromPayload(payload),
          durationMs: Math.max(0, Date.now() - started),
          tokenUsage: tokenUsage(result),
        });
      } catch {
        throw new AIDiagnosticError(
          'Gemini returned invalid structured analysis or invented evidence references. The result was discarded.',
        );
      }
    }
    throw new AIDiagnosticError(
      'The diagnostic could not be completed within its retry budget.',
    );
  } catch (error) {
    if (timedOut)
      throw new AIDiagnosticError(
        'The AI request timed out. Your report is unchanged. Retry manually when ready.',
      );
    if (controller.signal.aborted)
      throw new AIDiagnosticError(
        'AI diagnostic cancelled. Data already sent cannot be recalled from Google.',
      );
    if (error instanceof AIDiagnosticError) throw error;
    throw new AIDiagnosticError(
      'The AI request could not be completed. Your report is unchanged.',
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
