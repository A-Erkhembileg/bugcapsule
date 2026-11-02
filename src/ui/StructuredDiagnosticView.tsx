import { useState } from 'react';
import { Copy, FileSearch } from 'lucide-react';
import { validateDiagnosticForReport } from '../ai/schema';
import type { AiDiagnosticResult } from '../ai/schema';
import type { CaptureEvent, Report } from '../shared/types';

function EvidenceReferences({
  ids,
  events,
  label,
}: {
  ids: string[];
  events: CaptureEvent[];
  label: string;
}) {
  return (
    <div className="ai-evidence-references">
      <h4>{label}</h4>
      {ids.length === 0 ? (
        <p className="muted">No captured events cited.</p>
      ) : (
        ids.map((id) => {
          const event = events.find((item) => item.id === id);
          return (
            <details key={id}>
              <summary>
                <FileSearch size={13} />
                <code>{id}</code>
                {event && (
                  <span>
                    +{(event.offsetMs / 1000).toFixed(2)}s · {event.kind}
                  </span>
                )}
              </summary>
              {event ? (
                <div className="ai-evidence-detail">
                  <time dateTime={event.timestamp}>{event.timestamp}</time>
                  <pre>{event.message}</pre>
                  {event.source && (
                    <p>
                      {event.source}
                      {event.line !== undefined ? `:${event.line}` : ''}
                      {event.column !== undefined ? `:${event.column}` : ''}
                    </p>
                  )}
                  {event.stack && <pre>{event.stack}</pre>}
                </div>
              ) : (
                <p>
                  This event is no longer in the report. Run a fresh diagnostic.
                </p>
              )}
            </details>
          );
        })
      )}
    </div>
  );
}

function TextList({
  title,
  values,
  ordered = false,
}: {
  title: string;
  values: string[];
  ordered?: boolean;
}) {
  if (values.length === 0) return null;
  const items = values.map((value, index) => <li key={index}>{value}</li>);
  return (
    <section className="ai-text-list">
      <h4>{title}</h4>
      {ordered ? <ol>{items}</ol> : <ul>{items}</ul>}
    </section>
  );
}

export function StructuredDiagnosticView({
  diagnostic,
  report,
}: {
  diagnostic: AiDiagnosticResult;
  report: Report;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const [copyFallback, setCopyFallback] = useState(false);
  let valid: AiDiagnosticResult;
  try {
    valid = validateDiagnosticForReport(
      diagnostic,
      report.id,
      report.events.map((event) => event.id),
    );
  } catch {
    return (
      <p className="notice error-notice" role="alert">
        This diagnostic does not match the current report or its captured
        evidence. Remove it and run a fresh diagnostic.
      </p>
    );
  }
  const debuggingSteps = valid.recommendedDebuggingSteps
    .map((step, index) => `${index + 1}. ${step}`)
    .join('\n');
  async function copySteps() {
    try {
      await navigator.clipboard.writeText(debuggingSteps);
      setCopyStatus('Debugging steps copied.');
      setCopyFallback(false);
    } catch {
      setCopyStatus(
        'Clipboard access is unavailable. Select and copy the steps below.',
      );
      setCopyFallback(true);
    }
  }
  return (
    <div className="ai-structured-result" data-testid="ai-diagnostic-result">
      <dl className="ai-provenance">
        <div>
          <dt>Provider / model</dt>
          <dd>
            {valid.provider} · {valid.model}
          </dd>
        </div>
        <div>
          <dt>Generated</dt>
          <dd>
            <time dateTime={valid.generatedAt}>{valid.generatedAt}</time>
          </dd>
        </div>
        <div>
          <dt>Prompt / schema</dt>
          <dd>
            {valid.promptVersion} / {valid.schemaVersion}
          </dd>
        </div>
        <div>
          <dt>Analysis ID</dt>
          <dd>
            <code>{valid.analysisId}</code>
          </dd>
        </div>
      </dl>
      <section className="ai-summary">
        <h4>Summary</h4>
        <p>{valid.summary}</p>
      </section>
      <section className="ai-observations">
        <h4>Observed evidence</h4>
        {valid.observations.length ? (
          valid.observations.map((observation, index) => (
            <article key={index}>
              <p>{observation.description}</p>
              <EvidenceReferences
                label="Captured events"
                ids={observation.eventIds}
                events={report.events}
              />
            </article>
          ))
        ) : (
          <p>
            No event observations were supplied. See missing evidence below.
          </p>
        )}
      </section>
      <section className="ai-hypotheses">
        <h4>Root-cause hypotheses</h4>
        {valid.hypotheses.length ? (
          valid.hypotheses.map((hypothesis, index) => (
            <details key={hypothesis.hypothesisId} open={index === 0}>
              <summary>
                <span className="subtle-pill">{hypothesis.hypothesisId}</span>
                {hypothesis.title}
              </summary>
              <div className="ai-hypothesis-body">
                <p>{hypothesis.explanation}</p>
                <EvidenceReferences
                  label="Supporting events"
                  ids={hypothesis.supportingEventIds}
                  events={report.events}
                />
                <EvidenceReferences
                  label="Contradicting events"
                  ids={hypothesis.contradictingEventIds}
                  events={report.events}
                />
                <h5>Conditional fix</h5>
                <p>{hypothesis.suggestedFix}</p>
                <TextList
                  title="How to verify"
                  values={hypothesis.verificationSteps}
                  ordered
                />
                <h5>Uncertainty</h5>
                <p>{hypothesis.uncertaintyNotes}</p>
              </div>
            </details>
          ))
        ) : (
          <p>The supplied evidence did not support a root-cause hypothesis.</p>
        )}
      </section>
      <div className="ai-debugging-heading">
        <h4>Recommended debugging steps</h4>
        <button className="text-button" onClick={() => void copySteps()}>
          <Copy size={14} />
          Copy debugging steps
        </button>
      </div>
      <ol className="ai-debugging-steps">
        {valid.recommendedDebuggingSteps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      {copyStatus && (
        <p className="ai-hint" role="status">
          {copyStatus}
        </p>
      )}
      {copyFallback && (
        <textarea
          aria-label="Debugging steps to copy"
          readOnly
          rows={6}
          value={debuggingSteps}
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      <TextList title="Missing evidence" values={valid.missingEvidence} />
      <TextList title="Limitations" values={valid.limitations} />
      <p className="ai-hint">
        Schema validation confirms structure and event references. It does not
        establish that a hypothesis or suggested fix is correct.
      </p>
    </div>
  );
}
