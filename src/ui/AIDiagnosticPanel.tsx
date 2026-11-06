import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  KeyRound,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { CaptureState, Report } from '../shared/types';
import { aiRequest } from './api';
import type { AIStatus, PreparedDiagnostic } from './api';
import type { EditReport } from './ReportDetails';
import { GEMINI_ORIGIN } from '../services/aiDiagnostic';
import { StructuredDiagnosticView } from './StructuredDiagnosticView';

export function AIDiagnosticPanel({
  report,
  active,
  dirty,
  disabled,
  edit,
  onUpdated,
  onOpenSettings,
}: {
  report: Report;
  active: boolean;
  dirty: boolean;
  disabled: boolean;
  edit: EditReport;
  onUpdated: (state: CaptureState) => void;
  onOpenSettings: () => void;
}) {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [prepared, setPrepared] = useState<PreparedDiagnostic | null>(null);
  const [consent, setConsent] = useState(false);
  const [operation, setOperation] = useState<'prepare' | 'run' | ''>('');
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const requestId = useRef(0);
  const mounted = useRef(true);
  const running = operation === 'run' || Boolean(status?.running);
  const unavailable = disabled || active || dirty;

  const refreshStatus = useCallback(async () => {
    const next = await aiRequest<AIStatus>({ type: 'GET_AI_STATUS' });
    if (mounted.current) {
      setStatus(next);
      if (next.lastError) setError(next.lastError);
    }
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshStatus().catch((cause) => {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'AI settings are unavailable.',
        );
    });
    return () => {
      mounted.current = false;
    };
  }, [refreshStatus]);

  useEffect(() => {
    setPrepared(null);
    setConsent(false);
  }, [report]);

  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(() => {
      void refreshStatus().catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [status?.running, refreshStatus]);

  async function prepare() {
    setOperation('prepare');
    setError('');
    setFeedback('');
    setConsent(false);
    try {
      const preview = await aiRequest<PreparedDiagnostic>({
        type: 'PREPARE_AI_DIAGNOSTIC',
        reportId: report.id,
      });
      if (mounted.current) setPrepared(preview);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not prepare a diagnostic.',
        );
    } finally {
      if (mounted.current) setOperation('');
    }
  }

  async function analyze() {
    if (!prepared || !consent || unavailable || running) return;
    const current = ++requestId.current;
    setOperation('run');
    setError('');
    setFeedback('');
    setConsent(false);
    try {
      // This request must occur directly in the click handler to retain the user gesture.
      const granted = await chrome.permissions.request({
        origins: [GEMINI_ORIGIN],
      });
      if (!granted)
        throw new Error(
          'Google API access was not granted. Your report stayed local.',
        );
      if (!mounted.current || current !== requestId.current) return;
      const result = await aiRequest<{ state: CaptureState }>({
        type: 'RUN_AI_DIAGNOSTIC',
        reportId: report.id,
        fingerprint: prepared.fingerprint,
        consent: true,
      });
      if (!mounted.current || current !== requestId.current) return;
      onUpdated(result.state);
      setPrepared(null);
      setConsent(false);
      setFeedback(
        'Analysis saved. Review the AI-generated text before exporting.',
      );
    } catch (cause) {
      if (mounted.current && current === requestId.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The AI diagnostic failed. Your captured report is still available.',
        );
    } finally {
      if (mounted.current && current === requestId.current) {
        setOperation('');
        void refreshStatus().catch(() => undefined);
      }
    }
  }

  async function cancel() {
    // Invalidate a pending permission grant before awaiting a worker response.
    requestId.current++;
    setCanceling(true);
    setError('');
    try {
      const next = await aiRequest<AIStatus>({ type: 'CANCEL_AI_DIAGNOSTIC' });
      setStatus(next);
      setOperation('');
      setPrepared(null);
      setConsent(false);
      setFeedback(
        'Analysis canceled. Your captured report is available locally. Text already sent to Google cannot be recalled.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not cancel the diagnostic.',
      );
    } finally {
      setCanceling(false);
    }
  }

  return (
    <section
      className="panel ai-diagnostic-panel"
      aria-labelledby="ai-diagnostic-heading"
    >
      <div className="panel-heading">
        <div>
          <h2 id="ai-diagnostic-heading">
            <Sparkles size={18} />
            AI diagnostic
          </h2>
          <p>
            Ask Gemini for evidence-based hypotheses and developer next steps.
          </p>
        </div>
        <span className="subtle-pill">Optional · external service</span>
      </div>
      <p className="ai-scope-note">
        Only reviewed report text is sent. Screenshots, your API key, and
        previous AI output are excluded from the diagnostic payload.
      </p>
      {!status?.settings.hasKey && (
        <div className="ai-setup">
          <KeyRound size={17} />
          <span>Add your own Gemini API key to enable diagnostics.</span>
          <button className="text-button" onClick={onOpenSettings}>
            Open AI settings
          </button>
        </div>
      )}
      {error && (
        <div className="notice error-notice" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
        </div>
      )}
      {feedback && (
        <div className="notice success-notice" role="status">
          {feedback}
        </div>
      )}
      {status?.pending?.status === 'interrupted' && (
        <div className="notice" role="status">
          The previous diagnostic was interrupted before it completed. Your
          report is available locally. Review the payload and explicitly run it
          again when ready.
        </div>
      )}
      {running ? (
        <div className="ai-running" role="status">
          <Sparkles size={18} className="accent" />
          <span>
            Analyzing console errors…
            <small>
              Closing the popup does not cancel the worker request. A completed
              result or an interruption notice will be available when you reopen
              the report.
            </small>
          </span>
          <button
            className="button secondary small"
            disabled={canceling}
            onClick={() => void cancel()}
          >
            <Square size={12} />
            {canceling ? 'Canceling…' : 'Cancel analysis'}
          </button>
        </div>
      ) : (
        <button
          className="button primary"
          data-testid="run-ai-diagnostic"
          disabled={
            unavailable || operation === 'prepare' || !status?.settings.hasKey
          }
          onClick={() => void prepare()}
        >
          <Sparkles size={16} />
          {operation === 'prepare'
            ? 'Preparing reviewed payload…'
            : 'Run AI Diagnostic'}
        </button>
      )}
      {(active || dirty) && (
        <p className="ai-hint">
          {active
            ? 'Stop capture to prepare an AI diagnostic.'
            : 'Save your report changes before preparing an AI diagnostic.'}
        </p>
      )}
      {prepared && !running && (
        <div className="ai-consent" aria-label="Review AI transmission">
          <div className="panel-heading">
            <div>
              <h3>Review what Google will receive</h3>
              <p>Model · {prepared.model}</p>
              <p>
                Prompt · {prepared.promptVersion} · Maximum{' '}
                {prepared.maxAttempts}{' '}
                {prepared.maxAttempts === 1 ? 'attempt' : 'attempts'}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Close AI consent"
              onClick={() => {
                setPrepared(null);
                setConsent(false);
              }}
            >
              <X size={16} />
            </button>
          </div>
          <p>
            This sends sanitized, compressed report text to Google Gemini.
            Free-tier inputs and outputs may be used to improve Google products.
            Automated redaction can miss private details. Review the exact JSON
            below and edit your report first if anything should be removed.
          </p>
          {prepared.maxAttempts > 1 && (
            <p className="ai-retry-disclosure">
              You enabled transient-failure retries. This approval permits up to{' '}
              {prepared.maxAttempts} requests to this same model within the
              request deadline. Each attempt may consume quota or incur charges.
            </p>
          )}
          <details className="ai-payload">
            <summary>
              Exact diagnostic payload ·{' '}
              {prepared.payload.length.toLocaleString()} characters
            </summary>
            <pre>{prepared.payload}</pre>
          </details>
          <label className="review-checkbox">
            <input
              type="checkbox"
              checked={consent}
              disabled={unavailable}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              <strong>
                I reviewed this text and allow ReproQuill to send it to Google
                Gemini for this diagnostic.
              </strong>
              <small>
                This approval applies to this request only. Google account
                quotas and billing settings apply.
              </small>
            </span>
          </label>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() => {
                setPrepared(null);
                setConsent(false);
              }}
            >
              Keep report local
            </button>
            <button
              className="button primary"
              disabled={!consent || unavailable}
              onClick={() => void analyze()}
            >
              <Send size={15} />
              Send reviewed text to Gemini
            </button>
          </div>
        </div>
      )}
      {report.aiDiagnostic !== undefined && (
        <div className="ai-result">
          <div className="panel-heading">
            <div>
              <h3>AI-generated analysis</h3>
              <p>
                Hypotheses can be wrong. Verify recommendations before changing
                code.
              </p>
            </div>
            <button
              className="text-button danger"
              disabled={disabled || active || running}
              onClick={() =>
                edit((current) => {
                  const next = { ...current };
                  delete next.aiDiagnostic;
                  return next;
                })
              }
            >
              <Trash2 size={14} />
              Remove analysis
            </button>
          </div>
          {typeof report.aiDiagnostic === 'string' ? (
            <>
              <p className="ai-hint">
                Legacy text diagnostic. Its model, prompt version and generation
                time were not recorded.
              </p>
              <pre
                className="ai-result-markdown"
                data-testid="ai-diagnostic-result"
              >
                {report.aiDiagnostic || 'The saved analysis is empty.'}
              </pre>
              <details className="ai-edit">
                <summary>Edit diagnostic text</summary>
                <label htmlFor="ai-diagnostic-text">
                  Analysis included in exports
                  <textarea
                    id="ai-diagnostic-text"
                    rows={9}
                    maxLength={12000}
                    value={report.aiDiagnostic}
                    disabled={disabled || active || running}
                    onChange={(event) =>
                      edit((current) => ({
                        ...current,
                        aiDiagnostic: event.target.value,
                      }))
                    }
                  />
                </label>
                <p>
                  Save changes, then review the report again before exporting.
                </p>
              </details>
            </>
          ) : (
            <StructuredDiagnosticView
              diagnostic={report.aiDiagnostic}
              report={report}
            />
          )}
        </div>
      )}
    </section>
  );
}
