/** Runs in the page's MAIN world. Keep this function entirely self-contained. */
export function installInstrumentation(channel: string, expiresAt: number): boolean {
  type PageState = { channel: string; stop: () => void };
  const host = window as Window & { __bugcapsuleMainV1?: PageState };
  host.__bugcapsuleMainV1?.stop();
  if (!channel || channel.length > 200 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  let active = true;
  let count = 0;
  let rateStart = Date.now();
  let rateCount = 0;
  const original = console.error;
  const clean = (value: string, limit = 2000): string => value.slice(0, 8000)
    .replace(/https?:\/\/[^\s<>"']+/gi, (candidate) => {
      try { const url = new URL(candidate); return `${url.origin}${url.pathname}`; }
      catch { return '[url omitted]'; }
    })
    .replace(/\b(?:set-cookie|cookie)\s*:\s*[^\r\n]*/gi, 'Cookie: [REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, '[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]{30,}\b/g, '[REDACTED API key]')
    .replace(/\b(?:sk|ghp|github_pat|gho|ghu|ghs|ghr)[-_][A-Za-z0-9_-]{8,}\b/g, '[REDACTED token]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]')
    .replace(/(["']?\b(?:password|passwd|pwd|secret|client[_-]?secret|secret[_-]?key|token|(?:access|refresh|id)[_-]?token|session[_-]?(?:id|token)|api[_-]?key|authorization|cookie|set-cookie)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s,;\r\n}]+)/gim, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED EMAIL]')
    .slice(0, limit);
  const safeField = (value: object, name: string): string | undefined => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value : undefined;
  };
  const describe = (value: unknown): string => {
    if (typeof value === 'string') return clean(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value);
    if (value instanceof Error) return clean(safeField(value, 'message') ?? '[Error message unavailable]');
    return '[object omitted]';
  };
  const emit = (event: {
    kind: 'console-error' | 'error' | 'unhandled-rejection'; message: string;
    source?: string; line?: number; column?: number; stack?: string;
  }): void => {
    if (!active || Date.now() >= expiresAt || count >= 200) return;
    const now = Date.now();
    if (now - rateStart >= 1000) { rateStart = now; rateCount = 0; }
    if (rateCount >= 20) return;
    count += 1;
    rateCount += 1;
    window.postMessage({ source: 'bugcapsule', channel, event }, location.origin);
  };
  function wrappedError(this: Console, ...args: unknown[]): void {
    Reflect.apply(original, this, args);
    try {
      const firstError = args.slice(0, 10).find((arg) => arg instanceof Error);
      const stack = firstError instanceof Error ? safeField(firstError, 'stack') : undefined;
      emit({ kind: 'console-error', message: clean(args.slice(0, 10).map(describe).join(' ')),
        ...(stack ? { stack: clean(stack, 4000) } : {}) });
    } catch { /* Reporting must never break the host application. */ }
  }
  const onError = (event: ErrorEvent): void => {
    try {
      if (!event.message) return; // Resource load errors do not expose a JavaScript diagnostic.
      emit({ kind: 'error', message: clean(event.message),
        ...(event.filename ? { source: clean(event.filename, 1000) } : {}),
        ...(Number.isInteger(event.lineno) && event.lineno > 0 ? { line: event.lineno } : {}),
        ...(Number.isInteger(event.colno) && event.colno > 0 ? { column: event.colno } : {}) });
    } catch { /* Untrusted page diagnostics are best effort. */ }
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    try {
      const reason: unknown = event.reason;
      const stack = reason instanceof Error ? safeField(reason, 'stack') : undefined;
      emit({ kind: 'unhandled-rejection', message: describe(reason),
        ...(stack ? { stack: clean(stack, 4000) } : {}) });
    } catch { /* Never inspect arbitrary rejection objects. */ }
  };
  const stop = (): void => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('pagehide', stop);
    if (console.error === wrappedError) console.error = original;
    if (host.__bugcapsuleMainV1?.channel === channel) delete host.__bugcapsuleMainV1;
  };
  const timer = setTimeout(stop, Math.min(15 * 60 * 1000, expiresAt - Date.now()));
  host.__bugcapsuleMainV1 = { channel, stop };
  console.error = wrappedError;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('pagehide', stop);
  return true;
}

/** Runs in MAIN world; a stale session cannot stop its replacement. */
export function stopInstrumentation(channel: string): void {
  const host = window as Window & { __bugcapsuleMainV1?: { channel: string; stop: () => void } };
  if (host.__bugcapsuleMainV1?.channel === channel) host.__bugcapsuleMainV1.stop();
}
