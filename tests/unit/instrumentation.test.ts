// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installInstrumentation, stopInstrumentation } from '../../src/page/instrumentation';
import { installBridge, stopBridge } from '../../src/content/bridge';

const channel = 'test-session-1234';

describe('page instrumentation', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => { stopInstrumentation(channel); stopInstrumentation('replacement-session'); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('redacts common camel-case credentials and truncated strings before DOM messages', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    installInstrumentation(channel, Date.now() + 60_000);
    console.error('clientSecret=synthetic-client-secret sessionId=synthetic-session ' + 'AIza' + 'A'.repeat(35) + ' password="incomplete private string');
    expect(post).toHaveBeenCalledOnce();
    const message = JSON.stringify(post.mock.calls[0]?.[0]);
    expect(message).not.toContain('synthetic-client-secret');
    expect(message).not.toContain('synthetic-session');
    expect(message).not.toContain('AIza');
    expect(message).not.toContain('incomplete private string');
  });

  it('only observes errors after explicit start and stops restoring the original function', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const original = console.error;
    console.error('before capture');
    expect(post).not.toHaveBeenCalled();
    installInstrumentation(channel, Date.now() + 60_000);
    console.error('after start');
    expect(post).toHaveBeenCalledWith({ source: 'bugcapsule', channel,
      event: { kind: 'console-error', message: 'after start' } }, location.origin);
    stopInstrumentation(channel);
    expect(console.error).toBe(original);
    console.error('after stop');
    expect(post).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledTimes(3);
  });

  it('redacts known secrets before crossing the page bridge and omits object fields', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const getter = vi.fn(() => 'private getter content');
    const arbitrary = { get password() { return getter(); } };
    const trickyError = new Error('unused');
    Object.defineProperty(trickyError, 'message', { get: getter });
    Object.defineProperty(trickyError, 'stack', { get: getter });
    installInstrumentation(channel, Date.now() + 60_000);
    console.error('password=hunter2 token=secret-value Bearer abcdef user@example.com https://user:pass@example.com/path?key=secret#token', arbitrary, trickyError);
    const serialized = JSON.stringify(post.mock.calls);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('abcdef');
    expect(serialized).not.toContain('user@example.com');
    expect(serialized).not.toContain('user:pass');
    expect(serialized).not.toContain('?key');
    expect(serialized).toContain('[object omitted]');
    expect(serialized).toContain('https://example.com/path');
    expect(getter).not.toHaveBeenCalled();
  });

  it('omits entire cookie headers and known authorization/token formats before posting', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    installInstrumentation(channel, Date.now() + 60_000);
    console.error('Cookie: session=first-sensitive; other=second-sensitive');
    console.error('Authorization: Basic dGVzdC1vbmx5');
    console.error('unexpected ghp_syntheticsecret123');
    expect(JSON.stringify(post.mock.calls)).not.toMatch(/first-sensitive|second-sensitive|dGVzdC1vbmx5|syntheticsecret123/);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('observes JavaScript errors and promise rejections without cancelling the host event', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    installInstrumentation(channel, Date.now() + 60_000);
    window.dispatchEvent(new ErrorEvent('error', { message: 'Broken', filename: 'https://example.com/app.js?token=x', lineno: 14, colno: 2 }));
    const rejection = new Event('unhandledrejection', { cancelable: true });
    Object.defineProperty(rejection, 'reason', { value: new Error('Rejected') });
    window.dispatchEvent(rejection);
    expect(post.mock.calls[0]?.[0]).toEqual({ source: 'bugcapsule', channel,
      event: { kind: 'error', message: 'Broken', source: 'https://example.com/app.js', line: 14, column: 2 } });
    expect(post.mock.calls[1]?.[0]).toMatchObject({ event: { kind: 'unhandled-rejection', message: 'Rejected' } });
    expect(rejection.defaultPrevented).toBe(false);
  });

  it('bounds message size, rate and lifetime', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const original = console.error;
    installInstrumentation(channel, Date.now() + 1500);
    for (let index = 0; index < 100; index += 1) console.error('x'.repeat(10000));
    expect(post).toHaveBeenCalledTimes(20);
    expect((post.mock.calls[0]?.[0] as { event: { message: string } }).event.message).toHaveLength(2000);
    vi.advanceTimersByTime(1500);
    expect(console.error).toBe(original);
    console.error('expired');
    expect(post).toHaveBeenCalledTimes(20);
  });

  it('caps a whole session at 200 events', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    installInstrumentation(channel, Date.now() + 60_000);
    for (let second = 0; second < 12; second += 1) {
      for (let index = 0; index < 20; index += 1) console.error('bounded');
      vi.advanceTimersByTime(1000);
    }
    expect(post).toHaveBeenCalledTimes(200);
  });

  it('never overwrites a later page console patch and ignores stale stop commands', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    installInstrumentation(channel, Date.now() + 60_000);
    installInstrumentation('replacement-session', Date.now() + 60_000);
    const wrapper = console.error;
    stopInstrumentation(channel);
    expect(console.error).toBe(wrapper);
    const pageReplacement = vi.fn();
    console.error = pageReplacement;
    stopInstrumentation('replacement-session');
    expect(console.error).toBe(pageReplacement);
  });

  it('removes instrumentation on page exit', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    const original = console.error;
    installInstrumentation(channel, Date.now() + 60_000);
    window.dispatchEvent(new Event('pagehide'));
    expect(console.error).toBe(original);
    window.dispatchEvent(new ErrorEvent('error', { message: 'late' }));
    expect(post).not.toHaveBeenCalled();
  });
});

describe('isolated bridge', () => {
  const sendMessage = vi.fn<(...args: unknown[]) => Promise<unknown>>();
  const dispatch = (event: unknown, overrides: Partial<MessageEventInit> = {}) => {
    window.dispatchEvent(new MessageEvent('message', {
      source: window, origin: location.origin, data: { source: 'bugcapsule', channel, event }, ...overrides,
    }));
  };
  beforeEach(() => {
    vi.useFakeTimers();
    sendMessage.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
  });
  afterEach(() => {
    stopBridge(channel); stopBridge('replacement-session'); document.body.replaceChildren();
    vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
  });

  it('forwards only bounded diagnostics from the same window, origin and session', () => {
    installBridge(channel, false, Date.now() + 60_000);
    dispatch({ kind: 'console-error', message: 'allowed', privateExtra: 'discarded' });
    dispatch({ kind: 'error', message: 'wrong source' }, { source: null });
    dispatch({ kind: 'error', message: 'wrong origin' }, { origin: 'https://attacker.invalid' });
    dispatch({}, { data: { source: 'bugcapsule', channel: 'wrong', event: { kind: 'error', message: 'wrong session' } } });
    dispatch({ kind: 'click', message: 'page cannot send automatic interactions' });
    dispatch({ kind: 'error', message: 'a'.repeat(2001) });
    dispatch({ kind: 'error', message: 'bad coordinate', line: -1 });
    dispatch({ kind: 'error', message: 'bad stack', stack: {} });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'CAPTURE_EVENT', channel,
      event: { kind: 'console-error', message: 'allowed' } });
  });

  it('captures only fixed descriptions and never text, attributes or form values', () => {
    document.body.innerHTML = '<button id="sensitive-user" data-token="secret">Private button text</button><input value="private input"><div contenteditable="true">private editing</div>';
    installBridge(channel, true, Date.now() + 60_000);
    document.querySelector('button')?.click();
    document.querySelector('input')?.click();
    document.querySelector('div')?.click();
    window.dispatchEvent(new Event('hashchange'));
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({ event: { kind: 'click', message: 'Clicked button' } });
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({ event: { kind: 'navigation', message: 'Same-document navigation' } });
    expect(JSON.stringify(sendMessage.mock.calls)).not.toMatch(/private|sensitive|secret/i);
  });

  it('keeps interactions disabled unless explicitly enabled', () => {
    document.body.innerHTML = '<button>Click</button>';
    installBridge(channel, false, Date.now() + 60_000);
    document.querySelector('button')?.click();
    window.dispatchEvent(new Event('popstate'));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('stops on explicit stop, expiry and page exit; sessions can be replaced', () => {
    installBridge(channel, true, Date.now() + 1000);
    stopBridge(channel);
    dispatch({ kind: 'error', message: 'stopped' });
    installBridge(channel, true, Date.now() + 1000);
    vi.advanceTimersByTime(1000);
    dispatch({ kind: 'error', message: 'expired' });
    installBridge(channel, true, Date.now() + 60_000);
    installBridge('replacement-session', false, Date.now() + 60_000);
    stopBridge(channel);
    dispatch({}, { data: { source: 'bugcapsule', channel: 'replacement-session', event: { kind: 'error', message: 'current' } } });
    window.dispatchEvent(new Event('pagehide'));
    dispatch({}, { data: { source: 'bugcapsule', channel: 'replacement-session', event: { kind: 'error', message: 'after exit' } } });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects expired initialization and stops if the extension is unavailable', async () => {
    expect(() => installBridge(channel, true, Date.now() - 1)).toThrow('expired');
    sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated'));
    installBridge(channel, false, Date.now() + 60_000);
    dispatch({ kind: 'error', message: 'first' });
    await Promise.resolve();
    dispatch({ kind: 'error', message: 'no longer connected' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
