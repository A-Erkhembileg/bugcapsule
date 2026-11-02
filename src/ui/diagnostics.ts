import type { CaptureEvent } from '../shared/types';

export function isDiagnostic(kind: CaptureEvent['kind']) {
  return (
    kind === 'console-error' ||
    kind === 'error' ||
    kind === 'unhandled-rejection'
  );
}
