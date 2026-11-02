import type { Report } from '../shared/types';
import { exportedReportSchema, reportSchema } from './schema';
import { sanitizedReport } from './report';

function validateImportedImage(report: Report): Report {
  const image = report.screenshot;
  if (!image) return report;
  const prefix = 'data:image/png;base64,';
  const header = Uint8Array.from(
    atob(image.dataUrl.slice(prefix.length, prefix.length + 44)),
    (byte) => byte.charCodeAt(0),
  );
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const validHeader =
    header.length >= 24 &&
    signature.every((byte, index) => header[index] === byte) &&
    String.fromCharCode(...header.slice(12, 16)) === 'IHDR';
  if (!validHeader)
    throw new Error('The imported screenshot has an invalid PNG header.');
  const view = new DataView(header.buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (
    width !== image.width ||
    height !== image.height ||
    width * height > 16_000_000
  ) {
    throw new Error(
      'The imported screenshot dimensions do not match its PNG header or exceed the 16-million-pixel import limit.',
    );
  }
  return report;
}

/** Restore portable JSON only; imported screenshots require real PNG bytes. */
export function restorePortableReport(input: unknown): Report {
  const internal = reportSchema.safeParse(input);
  if (internal.success)
    return validateImportedImage(
      sanitizedReport({ ...internal.data, privacyReviewed: false }),
    );
  const portable = exportedReportSchema.parse(input);
  const { screenshot: omittedAttachment, ...text } = portable;
  void omittedAttachment;
  return sanitizedReport({ ...text, privacyReviewed: false });
}
