/** Runs in the extension's isolated world. Keep this function self-contained. */
export function installBridge(channel: string, timelineEnabled: boolean, expiresAt: number) {
  type BridgeState = { channel: string; stop: () => void };
  type Diagnostic = { kind: string; message: string; source?: string; line?: number; column?: number; stack?: string };
  const host = window as Window & { __bugcapsuleBridgeV1?: BridgeState };
  host.__bugcapsuleBridgeV1?.stop();
  if (!channel || channel.length > 200 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error('Invalid or expired capture session.');
  }
  let active = true;
  let count = 0;
  let rateStart = Date.now();
  let rateCount = 0;
  const send = (event: Diagnostic): void => {
    if (!active || Date.now() >= expiresAt || count >= 200) return;
    const now = Date.now();
    if (now - rateStart >= 1000) { rateStart = now; rateCount = 0; }
    if (rateCount >= 20) return;
    count += 1;
    rateCount += 1;
    try {
      void chrome.runtime.sendMessage({ type: 'CAPTURE_EVENT', channel, event }).catch(() => stop());
    } catch { stop(); }
  };
  const onMessage = (message: MessageEvent<unknown>): void => {
    if (message.source !== window || message.origin !== location.origin) return;
    const data = message.data;
    if (!data || typeof data !== 'object') return;
    const envelope = data as Record<string, unknown>;
    if (envelope.source !== 'bugcapsule' || envelope.channel !== channel || !envelope.event || typeof envelope.event !== 'object') return;
    const raw = envelope.event as Record<string, unknown>;
    if (typeof raw.kind !== 'string' || !['console-error', 'error', 'unhandled-rejection'].includes(raw.kind)) return;
    if (typeof raw.message !== 'string' || raw.message.length > 2000) return;
    if (raw.source !== undefined && (typeof raw.source !== 'string' || raw.source.length > 1000)) return;
    if (raw.stack !== undefined && (typeof raw.stack !== 'string' || raw.stack.length > 4000)) return;
    for (const field of ['line', 'column']) {
      const value = raw[field];
      if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) return;
    }
    send({ kind: raw.kind as string, message: raw.message,
      ...(typeof raw.source === 'string' ? { source: raw.source } : {}),
      ...(typeof raw.stack === 'string' ? { stack: raw.stack } : {}),
      ...(typeof raw.line === 'number' ? { line: raw.line } : {}),
      ...(typeof raw.column === 'number' ? { column: raw.column } : {}) });
  };
  const onClick = (event: MouseEvent): void => {
    const element = event.target;
    if (!(element instanceof Element) || element.closest('input,textarea,select,[contenteditable]')) return;
    // Only a fixed vocabulary is allowed. No text, values, attributes, or selectors.
    const nearest = element.closest('button,a,summary,label');
    const tag = nearest?.tagName.toLowerCase();
    const description = tag === 'button' ? 'button' : tag === 'a' ? 'link' : tag === 'summary' ? 'disclosure' : 'page element';
    send({ kind: 'click', message: `Clicked ${description}` });
  };
  const onNavigation = (): void => send({ kind: 'navigation', message: 'Same-document navigation' });
  const stop = (): void => {
    if (!active) return;
    active = false;
    clearTimeout(timer);
    window.removeEventListener('message', onMessage);
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('popstate', onNavigation);
    window.removeEventListener('hashchange', onNavigation);
    window.removeEventListener('pagehide', stop);
    if (host.__bugcapsuleBridgeV1?.channel === channel) delete host.__bugcapsuleBridgeV1;
  };
  const timer = setTimeout(stop, Math.min(15 * 60 * 1000, expiresAt - Date.now()));
  host.__bugcapsuleBridgeV1 = { channel, stop };
  window.addEventListener('message', onMessage);
  window.addEventListener('pagehide', stop);
  if (timelineEnabled) {
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onNavigation);
    window.addEventListener('hashchange', onNavigation);
  }
  return {
    url: (location.origin + location.pathname).slice(0, 2048),
    browser: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    language: navigator.language,
  };
}

/** Runs in the isolated world; a stale session cannot stop its replacement. */
export function stopBridge(channel: string): void {
  const host = window as Window & { __bugcapsuleBridgeV1?: { channel: string; stop: () => void } };
  if (host.__bugcapsuleBridgeV1?.channel === channel) host.__bugcapsuleBridgeV1.stop();
}

/** Isolated-world probe for recovery after a service-worker restart. */
export function bridgeIsActive(channel: string): boolean {
  const host = window as Window & { __bugcapsuleBridgeV1?: { channel: string } };
  return host.__bugcapsuleBridgeV1?.channel === channel;
}
