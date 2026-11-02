import { strToU8, zipSync } from 'fflate';
import type { Report } from '../shared/types';
import { sanitizedReport } from './report';
import { exportedReportSchema } from './schema';
import type { AiDiagnosticResult } from '../ai/schema';

function requireReview(report: Report): void {
  if (!report.privacyReviewed)
    throw new Error(
      'Review the report and approve its contents before exporting.',
    );
}

function exportObject(input: Report) {
  const report = sanitizedReport(input);
  const { screenshot, ...rest } = report;
  return exportedReportSchema.parse({
    ...rest,
    ...(screenshot
      ? {
          screenshot: {
            file: 'screenshot.png',
            mimeType: 'image/png',
            width: screenshot.width,
            height: screenshot.height,
            redacted: screenshot.redacted,
          },
        }
      : {}),
  });
}

/** Fixed schema key order, input event order, and no export-time timestamps. */
export function serializeReport(report: Report): string {
  requireReview(report);
  return `${JSON.stringify(exportObject(report), null, 2)}\n`;
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+.!|~-])/g, '\\$1');
}

function codeBlock(value: string): string {
  const ticks = value.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...ticks.map((run) => run.length + 1)));
  return `${fence}text\n${value}\n${fence}`;
}

function structuredDiagnosticMarkdown(analysis: AiDiagnosticResult): string[] {
  const text = escapeMarkdown;
  const refs = (ids: string[]) =>
    ids.length ? ids.map(text).join(', ') : 'None recorded';
  const steps = (values: string[]) =>
    values.map(
      (value, index) => `${index + 1}. ${text(value).replace(/\n/g, '\n   ')}`,
    );
  return [
    `- Provider: ${analysis.provider}`,
    `- Model: ${analysis.model}`,
    `- Prompt version: ${analysis.promptVersion}`,
    `- Generated: ${analysis.generatedAt}`,
    `- Analysis ID: ${text(analysis.analysisId)}`,
    '',
    '### Summary',
    '',
    text(analysis.summary),
    '',
    '### Observed evidence',
    '',
    ...(analysis.observations.length
      ? analysis.observations.flatMap((observation) => [
          `- ${text(observation.description)} (events: ${refs(observation.eventIds)})`,
        ])
      : ['No observations were supported by captured events.']),
    '',
    '### Root-cause hypotheses',
    '',
    ...(analysis.hypotheses.length
      ? analysis.hypotheses.flatMap((hypothesis) => [
          `#### ${text(hypothesis.hypothesisId)}. ${text(hypothesis.title)}`,
          '',
          text(hypothesis.explanation),
          '',
          `Supporting events: ${refs(hypothesis.supportingEventIds)}`,
          '',
          `Contradicting events: ${refs(hypothesis.contradictingEventIds)}`,
          '',
          'Suggested fix (unverified):',
          '',
          text(hypothesis.suggestedFix),
          '',
          'Verification steps:',
          '',
          ...steps(hypothesis.verificationSteps),
          '',
          `Uncertainty: ${text(hypothesis.uncertaintyNotes)}`,
          '',
        ])
      : ['Insufficient evidence to propose a grounded hypothesis.', '']),
    '### Recommended debugging steps',
    '',
    ...steps(analysis.recommendedDebuggingSteps),
    '',
    '### Missing evidence',
    '',
    ...(analysis.missingEvidence.length
      ? analysis.missingEvidence.map((value) => `- ${text(value)}`)
      : ['No additional evidence listed.']),
    '',
    '### Limitations',
    '',
    ...analysis.limitations.map((value) => `- ${text(value)}`),
    '',
  ];
}

/** A local text preview. This helper deliberately does not authorize export. */
export function previewReportMarkdown(input: Report): string {
  const report = sanitizedReport(input);
  const env = report.environment;
  const text = (value: string) =>
    escapeMarkdown(value.trim() || 'Not provided');
  const lines = [
    `# ${text(report.title || 'Untitled bug report')}`,
    '',
    '> Captured with BugCapsule · Capture bugs. Share context. Reproduce faster.',
    '',
    '## Description',
    '',
    text(report.description),
    '',
    '## Reproduction steps',
    '',
    ...(report.steps.length
      ? report.steps.map(
          (step, index) =>
            `${index + 1}. ${text(step).replace(/\n/g, '\n   ')}`,
        )
      : ['No steps provided.']),
    '',
    '## Expected behavior',
    '',
    text(report.expectedBehavior),
    '',
    '## Actual behavior',
    '',
    text(report.actualBehavior),
    '',
    '## Environment',
    '',
    `- URL: ${text(env.url)}`,
    `- Browser: ${text(env.browser)}`,
    `- Viewport: ${env.viewport.width} × ${env.viewport.height} CSS px`,
    `- Device pixel ratio: ${env.viewport.devicePixelRatio}`,
    `- Language: ${text(env.language)}`,
    `- Capture started: ${report.createdAt}`,
    `- Report ID: ${text(report.id)}`,
    `- Schema: ${report.schemaVersion}`,
    '',
    '## Captured events',
    '',
    ...(report.events.length
      ? report.events.flatMap((event, index) => [
          `### ${index + 1}. +${(event.offsetMs / 1_000).toFixed(3)}s · ${event.kind}`,
          '',
          `Timestamp: ${event.timestamp}`,
          '',
          `Event ID: ${text(event.id)}`,
          '',
          codeBlock(event.message),
          '',
          ...(event.source
            ? [
                `Location: ${text(event.source)}${event.line !== undefined ? `:${event.line}` : ''}${event.column !== undefined ? `:${event.column}` : ''}`,
                '',
              ]
            : []),
          ...(event.stack ? [codeBlock(event.stack), ''] : []),
        ])
      : ['No events captured.', '']),
    '## Screenshot',
    '',
    ...(report.screenshot
      ? [
          '![Approved screenshot](screenshot.png)',
          '',
          `Manual redaction applied: ${report.screenshot.redacted ? 'yes' : 'no'}. Screenshot is included in the ZIP export; standalone Markdown and JSON contain only its reference.`,
          '',
        ]
      : ['No screenshot included.', '']),
    ...(report.aiDiagnostic !== undefined
      ? [
          '## AI diagnostic',
          '',
          'AI-generated debugging hypotheses. Verify the suggestions against the application and source code before applying changes.',
          '',
          ...(typeof report.aiDiagnostic === 'string'
            ? [
                'Legacy free-form analysis. Model, prompt version and generation time were not recorded.',
                '',
                codeBlock(report.aiDiagnostic),
              ]
            : structuredDiagnosticMarkdown(report.aiDiagnostic)),
          '',
        ]
      : []),
    '## Privacy and capture scope',
    '',
    `Privacy review: ${report.privacyReviewed ? 'approved by the reporter' : 'pending'}.`,
    '',
    'Only events observed after explicit activation in the main document are included. Capture stops on full navigation. No keystrokes, form values, cookies, request bodies, or console object contents are intentionally collected. Error strings and URL paths can still contain private data. Automated redaction is best effort; review text and screenshot before sharing.',
    '',
  ];
  return lines.join('\n');
}

export function reportMarkdown(report: Report): string {
  requireReview(report);
  return previewReportMarkdown(report);
}

export function exportZip(report: Report): Uint8Array {
  requireReview(report);
  const clean = sanitizedReport(report);
  // DOS ZIP timestamps are local-calendar values: use local construction so bytes
  // are identical across time zones as well as repeated calls on one machine.
  const options = { mtime: new Date(1980, 0, 1, 0, 0, 0), level: 6 as const };
  const files: Record<string, [Uint8Array, typeof options]> = {
    'report.md': [strToU8(reportMarkdown(clean)), options],
    'report.json': [strToU8(serializeReport(clean)), options],
  };
  if (clean.screenshot) {
    const encoded = clean.screenshot.dataUrl.slice(
      'data:image/png;base64,'.length,
    );
    const binary = atob(encoded);
    files['screenshot.png'] = [
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
      options,
    ];
  }
  return zipSync(files);
}
