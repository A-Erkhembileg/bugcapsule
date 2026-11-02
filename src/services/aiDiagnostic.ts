import { AIDiagnosticError } from './aiError';
const KEY_STORAGE = 'bugcapsuleGeminiKey';
export { AIDiagnosticError } from './aiError';
export {
  GEMINI_MODEL,
  GEMINI_ORIGIN,
  GEMINI_ENDPOINT,
  AI_OUTPUT_LIMIT,
} from './aiConfiguration';
export { AI_INPUT_LIMIT, buildDiagnosticPayload } from '../ai/payload';
export { DIAGNOSTIC_SYSTEM_PROMPT, AI_PROMPT_VERSION } from '../ai/prompt';
export { runGeminiDiagnostic } from './geminiTransport';
export type { DiagnosticOptions } from './geminiTransport';

export async function diagnosticFingerprint(payload: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export class GeminiKeyStore {
  constructor(private readonly api: typeof chrome = chrome) {}

  private async secureAccess() {
    await this.api.storage.local.setAccessLevel({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
    await this.api.storage.session.setAccessLevel({
      accessLevel: 'TRUSTED_CONTEXTS',
    });
  }

  async read(): Promise<string | null> {
    await this.secureAccess();
    const session = await this.api.storage.session.get(KEY_STORAGE);
    if (typeof session[KEY_STORAGE] === 'string') return session[KEY_STORAGE];
    const local = await this.api.storage.local.get(KEY_STORAGE);
    return typeof local[KEY_STORAGE] === 'string' ? local[KEY_STORAGE] : null;
  }

  async status() {
    await this.secureAccess();
    const session = await this.api.storage.session.get(KEY_STORAGE);
    const local = await this.api.storage.local.get(KEY_STORAGE);
    return {
      hasKey:
        typeof session[KEY_STORAGE] === 'string' ||
        typeof local[KEY_STORAGE] === 'string',
      remembered: typeof local[KEY_STORAGE] === 'string',
    };
  }

  async save(value: string, remember: boolean) {
    const key = value.trim();
    if (!/^[A-Za-z0-9_-]{6,200}$/.test(key))
      throw new AIDiagnosticError(
        'Enter a valid Gemini API key without spaces.',
      );
    await this.secureAccess();
    // Remove both locations first so changing retention never leaves a durable old key.
    await this.clear();
    await (remember ? this.api.storage.local : this.api.storage.session).set({
      [KEY_STORAGE]: key,
    });
  }

  async clear() {
    await this.secureAccess();
    const results = await Promise.allSettled([
      this.api.storage.local.remove(KEY_STORAGE),
      this.api.storage.session.remove(KEY_STORAGE),
    ]);
    if (results.some((result) => result.status === 'rejected'))
      throw new AIDiagnosticError(
        'The key could not be fully removed from device storage. Retry Forget key.',
      );
  }
}
