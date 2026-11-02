export const MAX_MESSAGE_LENGTH = 2_000;
export const MAX_STACK_LENGTH = 4_000;
export const MAX_EVENTS = 200;
export const MAX_SCREENSHOT_LENGTH = 2_000_000;

/** Retain only the origin and path. Paths can still contain personal data. */
export function sanitizeUrl(value: string): string {
  if (!value.trim()) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol))
      return '[location unavailable]';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 2_048);
  } catch {
    return '[location unavailable]';
  }
}

/** Best-effort patterns, never a guarantee that free text is safe to share. */
export function sanitizeText(
  value: string,
  maxLength = MAX_MESSAGE_LENGTH,
): string {
  const bounded = value.slice(0, 32_000);
  return (
    bounded
      .replace(/\bhttps?:\/\/[^\s<>"'`]+/gi, (url) => sanitizeUrl(url))
      .replace(/\b(?:set-cookie|cookie)\s*:\s*[^\r\n]*/gi, 'Cookie: [REDACTED]')
      .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[REDACTED]')
      .replace(/\bAIza[A-Za-z0-9_-]{30,}\b/g, '[REDACTED API key]')
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g,
        '[REDACTED token]',
      )
      .replace(
        /\b(?:sk|ghp|github_pat|gho|ghu|ghs|ghr)[-_][A-Za-z0-9_-]{8,}\b/g,
        '[REDACTED token]',
      )
      .replace(
        /(["']?\b(?:password|passwd|pwd|secret|client[_-]?secret|secret[_-]?key|token|(?:access|refresh|id)[_-]?token|session[_-]?(?:id|token)|api[_-]?key|authorization|cookie|set-cookie)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\s,;\r\n}]+)/gim,
        '$1[REDACTED]',
      )
      .replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        '[REDACTED email]',
      )
      // Intentionally remove non-printing controls, preserving tabs and newlines.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .slice(0, Math.max(0, maxLength))
  );
}
