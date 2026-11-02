import { EvidencePanel } from './EvidencePanel';
import { ReportDetails } from './ReportDetails';
import { EmptyWorkspace } from './EmptyWorkspace';
import { PrivacySettings } from './PrivacySettings';
import { AIDiagnosticPanel } from './AIDiagnosticPanel';
import { ReportImporter } from './ReportImporter';
import { useCallback, useEffect, useRef, useState } from 'react';
import { version as appVersion } from '../../package.json';
import type { KeyboardEvent } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  Camera,
  Check,
  ChevronRight,
  Circle,
  ExternalLink,
  FileJson,
  FileText,
  FolderArchive,
  Layers3,
  LockKeyhole,
  Moon,
  Play,
  ScanLine,
  Settings2,
  ShieldCheck,
  Square,
  Sun,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { CaptureState, Report } from '../shared/types';
import {
  exportZip,
  previewReportMarkdown,
  reportMarkdown,
  serializeReport,
} from '../core';
import { download, request } from './api';
import type { Request } from './api';
import { isDiagnostic } from './diagnostics';

type Tab = 'details' | 'evidence' | 'preview';
const reportTabs: readonly Tab[] = ['details', 'evidence', 'preview'];

const initialState: CaptureState = {
  report: null,
  active: false,
  tabId: null,
  startedAt: null,
  timelineEnabled: false,
  notice: null,
  droppedEvents: 0,
};

function initialTheme() {
  try {
    return localStorage.getItem('bugcapsule-theme') === 'light'
      ? 'light'
      : 'dark';
  } catch {
    return 'dark';
  }
}

function markdownPreview(report: Report) {
  try {
    return previewReportMarkdown(report);
  } catch {
    return 'Preview is unavailable until report fields meet the size limits. Save your changes to see validation details.';
  }
}

export function App() {
  const [state, setState] = useState<CaptureState>(initialState);
  const [draft, setDraft] = useState<Report | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const reportId = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [tab, setTab] = useState<Tab>('details');
  const [settings, setSettings] = useState(false);
  const [timeline, setTimeline] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'start' | null>(null);
  const [theme, setTheme] = useState(initialTheme);
  const [elapsed, setElapsed] = useState(0);

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    const index = reportTabs.indexOf(current);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % reportTabs.length;
        break;
      case 'ArrowLeft':
        nextIndex = (index + reportTabs.length - 1) % reportTabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = reportTabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = reportTabs[nextIndex]!;
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  const accept = useCallback((next: CaptureState, force = false) => {
    setState(next);
    if (force || !dirtyRef.current || next.report?.id !== reportId.current) {
      setDraft(next.report);
      reportId.current = next.report?.id ?? null;
      dirtyRef.current = false;
      setDirty(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      request({ type: 'GET_STATE' })
        .then((next) => {
          if (alive) accept(next);
        })
        .catch((cause) => {
          if (alive)
            setError(String(cause instanceof Error ? cause.message : cause));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    void load();
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'session' && 'capture' in changes) void load();
    };
    globalThis.chrome?.storage?.onChanged.addListener(listener);
    return () => {
      alive = false;
      globalThis.chrome?.storage?.onChanged.removeListener(listener);
    };
  }, [accept]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('bugcapsule-theme', theme);
    } catch {
      /* Theme persistence is optional. */
    }
  }, [theme]);
  useEffect(() => {
    const tick = () =>
      setElapsed(
        state.startedAt
          ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000))
          : 0,
      );
    tick();
    if (!state.active) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [state.active, state.startedAt]);

  function edit(update: (current: Report) => Report) {
    if (state.active) return;
    setDraft((current) => {
      if (!current) return null;
      const next = { ...update(current), privacyReviewed: false };
      // Evidence changes invalidate hypotheses, while the analysis itself stays editable.
      const previousEvidence = {
        ...current,
        aiDiagnostic: undefined,
        privacyReviewed: false,
      };
      const nextEvidence = {
        ...next,
        aiDiagnostic: undefined,
        privacyReviewed: false,
      };
      if (JSON.stringify(previousEvidence) !== JSON.stringify(nextEvidence))
        delete next.aiDiagnostic;
      return next;
    });
    dirtyRef.current = true;
    setDirty(true);
    setFeedback('');
  }
  async function run(message: Request, label: string, success?: string) {
    setBusy(label);
    setError('');
    setFeedback('');
    try {
      const next = await request(message);
      accept(next, true);
      if (success) setFeedback(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy('');
    }
  }
  async function save() {
    if (!draft) return false;
    if (
      draft.steps.length > 50 ||
      draft.steps.some((step) => step.length > 2000)
    ) {
      setError(
        'Use up to 50 reproduction steps with at most 2,000 characters per step.',
      );
      return false;
    }
    return run(
      { type: 'UPDATE_REPORT', report: draft },
      'Saving',
      'Changes saved locally.',
    );
  }
  async function screenshot() {
    if (dirty && !(await save())) return;
    if (
      await run(
        { type: 'TAKE_SCREENSHOT' },
        'Taking screenshot',
        'Screenshot added. Review it before export.',
      )
    )
      setTab('evidence');
  }
  async function start() {
    setConfirm(null);
    const message: Request = {
      type: 'START_CAPTURE',
      timelineEnabled: timeline,
    };
    if (draft) message.replaceReportId = draft.id;
    if (await run(message, 'Starting capture')) {
      setTab('details');
      setSettings(false);
    }
  }
  async function removeAll() {
    setConfirm(null);
    if (
      await run(
        { type: 'DELETE_ALL' },
        'Deleting',
        'All BugCapsule capture data deleted.',
      )
    ) {
      try {
        localStorage.removeItem('bugcapsule-theme');
      } catch {
        /* Storage may be unavailable. */
      }
      setTheme('dark');
      setTimeline(false);
      setSettings(false);
    }
  }
  async function openEditor() {
    if (dirty && !(await save())) return;
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL('index.html?view=full'),
      });
    } catch {
      setError(
        'Could not open the editor. You can continue editing in this popup.',
      );
    }
  }

  async function importReport(report: Report) {
    const message: Request = { type: 'IMPORT_REPORT', report };
    if (state.report) message.replaceReportId = state.report.id;
    const imported = await run(
      message,
      'Importing report',
      'Report imported locally. Review the evidence and attachments before export or AI analysis.',
    );
    if (imported) {
      setSettings(false);
      setTab('details');
    }
    return imported;
  }

  async function exportReport(format: 'markdown' | 'json' | 'zip') {
    if (!draft || state.active || dirty || !draft.privacyReviewed) return;
    setError('');
    setBusy('Preparing download');
    try {
      // Another editor may have changed the saved review or deleted the report.
      const latest = await request({ type: 'GET_STATE' });
      if (
        latest.active ||
        !latest.report?.privacyReviewed ||
        JSON.stringify(latest.report) !== JSON.stringify(draft)
      ) {
        accept(latest, true);
        throw new Error(
          'The saved report changed. Review the current version before downloading.',
        );
      }
      if (format === 'markdown')
        download(
          'bugcapsule-report.md',
          reportMarkdown(draft),
          'text/markdown;charset=utf-8',
        );
      if (format === 'json')
        download(
          'bugcapsule-report.json',
          serializeReport(draft),
          'application/json',
        );
      if (format === 'zip')
        download('bugcapsule-report.zip', exportZip(draft), 'application/zip');
      setFeedback(
        `${format === 'zip' ? 'ZIP archive' : format === 'json' ? 'JSON report' : 'Markdown report'} download started.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy('');
    }
  }
  const disabled = Boolean(busy) || loading;
  const editingDisabled = disabled || state.active;
  const events = draft?.events ?? [];
  const errors = events.filter((event) => isDiagnostic(event.kind)).length;
  const exportReady = Boolean(
    draft?.privacyReviewed && !dirty && !state.active && !disabled,
  );
  const duration = `${Math.floor(elapsed / 60)
    .toString()
    .padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#workspace"
          aria-label="BugCapsule workspace"
        >
          <img src="/icon.svg" alt="" />
          <span>
            BugCapsule<span className="brand-version">LOCAL FIRST · v{appVersion}</span>
          </span>
        </a>
        <div className="nav-group">
          <span className="nav-caption">WORKSPACE</span>
          <button
            className={`nav-item ${!settings ? 'selected' : ''}`}
            onClick={() => setSettings(false)}
          >
            <Layers3 size={17} />
            Bug report
            <ChevronRight size={14} className="nav-arrow" />
          </button>
          <button
            className={`nav-item ${settings ? 'selected' : ''}`}
            onClick={() => setSettings(true)}
          >
            <Settings2 size={17} />
            Settings & privacy
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <LockKeyhole size={17} />
            <div>
              <strong>You control sharing.</strong>
              <p>
                Local capture. Optional AI.
                <br />
                Just the context you choose.
              </p>
            </div>
          </div>
          <div className="sidebar-controls">
            <span>OPEN SOURCE / MIT</span>
            <button
              className="icon-button"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </div>
      </aside>
      <main id="workspace" className="workspace">
        <header className="topbar">
          <span>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={13} />
            {settings ? 'Settings & privacy' : 'Bug report'}
          </span>
          {document.documentElement.dataset.layout !== 'full' && (
            <button
              className="text-button"
              title="Open editor in a browser tab"
              disabled={disabled}
              onClick={() => void openEditor()}
            >
              <ExternalLink size={14} />
              <span>Open editor</span>
            </button>
          )}
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {settings
                  ? 'PRIVACY BY DESIGN'
                  : 'A LITTLE CONTEXT GOES A LONG WAY'}
              </div>
              <h1>
                {settings
                  ? 'Local. On your terms.'
                  : 'Make the bug reproducible.'}
              </h1>
              <p>
                {settings
                  ? 'Understand exactly what goes into your report.'
                  : 'Capture bugs. Share context. Reproduce faster.'}
              </p>
            </div>
            <span className="local-badge">
              <ShieldCheck size={14} />
              Local-first
            </span>
          </div>
          {error && (
            <div className="notice error-notice" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {feedback && (
            <div className="notice success-notice" role="status">
              <Check size={17} />
              <span>{feedback}</span>
            </div>
          )}
          {state.notice && (
            <div className="notice" role="status">
              <AlertCircle size={17} />
              <span>{state.notice}</span>
            </div>
          )}
          {!settings && (
            <ReportImporter
              disabled={disabled || state.active}
              hasReport={Boolean(draft)}
              onImport={importReport}
            />
          )}
          {confirm && (
            <div className="confirmation" role="alert">
              <div>
                <strong>
                  {confirm === 'delete'
                    ? 'Delete all local capture data?'
                    : 'Replace the current report?'}
                </strong>
                <p>
                  {confirm === 'delete'
                    ? 'This stops collection and removes the report and screenshot. Downloaded files remain on your computer.'
                    : 'Starting a new capture discards the current report. Export it first if you want to keep it.'}
                </p>
              </div>
              <div className="button-row">
                <button
                  className="button secondary"
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  className="button danger-solid"
                  onClick={() =>
                    void (confirm === 'delete' ? removeAll() : start())
                  }
                >
                  {confirm === 'delete'
                    ? 'Delete all data'
                    : 'Start new capture'}
                </button>
              </div>
            </div>
          )}
          {settings ? (
            <PrivacySettings
              disabled={disabled}
              onDelete={() => setConfirm('delete')}
            />
          ) : (
            <>
              <section
                className={`capture-card ${state.active ? 'is-recording' : ''}`}
                aria-label="Capture controls"
              >
                <div className="capture-summary">
                  <div
                    className={`capture-symbol ${state.active ? 'live' : ''}`}
                  >
                    <ScanLine size={23} />
                  </div>
                  <div>
                    <div className="capture-status">
                      <span
                        className={`status-dot ${state.active ? 'live' : ''}`}
                      />
                      <span data-testid="capture-status">
                        {loading
                          ? 'Loading workspace'
                          : state.active
                            ? 'Capture is active'
                            : draft
                              ? 'Capture stopped'
                              : 'Ready when you are'}
                      </span>
                      {state.active && (
                        <span
                          className="timer"
                          aria-label={`Capture duration ${duration}`}
                        >
                          {duration}
                        </span>
                      )}
                    </div>
                    <p>
                      {state.active
                        ? 'New errors are being collected from this tab.'
                        : draft
                          ? 'Review the details, remove anything private, and export.'
                          : 'Open the affected page, then start a capture.'}
                    </p>
                  </div>
                </div>
                <div className="capture-actions">
                  {state.active ? (
                    <button
                      className="button stop-button"
                      disabled={disabled}
                      onClick={() =>
                        void run(
                          { type: 'STOP_CAPTURE' },
                          'Stopping',
                          'Capture stopped. Your report is ready to edit.',
                        )
                      }
                    >
                      <Square size={14} fill="currentColor" />
                      Stop capture
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      disabled={disabled}
                      onClick={() =>
                        draft ? setConfirm('start') : void start()
                      }
                    >
                      <Play size={15} fill="currentColor" />
                      {draft ? 'New capture' : 'Start capture'}
                    </button>
                  )}
                  <button
                    className="button secondary"
                    disabled={disabled || !draft}
                    onClick={() => void screenshot()}
                  >
                    <Camera size={17} />
                    Screenshot
                  </button>
                </div>
                <div className="capture-options">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={state.active ? state.timelineEnabled : timeline}
                      disabled={disabled || state.active}
                      onChange={(event) => setTimeline(event.target.checked)}
                    />
                    <span>Include safe interaction timeline</span>
                  </label>
                  <span className="capture-privacy">
                    <LockKeyhole size={12} />
                    No form values or keystrokes
                  </span>
                </div>
              </section>
              {busy && (
                <p className="operation-status" role="status">
                  {busy}…
                </p>
              )}
              <div className="stats-row">
                <div>
                  <Terminal size={17} />
                  <span>Errors captured</span>
                  <strong>{errors.toString().padStart(2, '0')}</strong>
                </div>
                <div>
                  <Layers3 size={17} />
                  <span>Timeline events</span>
                  <strong>{events.length.toString().padStart(2, '0')}</strong>
                </div>
                <div>
                  <Camera size={17} />
                  <span>Screenshot</span>
                  <strong className="text-stat">
                    {draft?.screenshot ? 'Attached' : 'None yet'}
                  </strong>
                </div>
              </div>
              {state.droppedEvents > 0 && (
                <p className="notice">
                  Collection reached its safety limit. Some events were omitted.
                </p>
              )}
              {!draft ? (
                <EmptyWorkspace />
              ) : (
                <>
                  <div className="report-toolbar">
                    <div
                      className="tabs"
                      role="tablist"
                      aria-label="Report sections"
                    >
                      {reportTabs.map((value) => (
                        <button
                          id={`tab-${value}`}
                          aria-controls={`panel-${value}`}
                          role="tab"
                          aria-selected={tab === value}
                          tabIndex={tab === value ? 0 : -1}
                          className={tab === value ? 'active' : ''}
                          onClick={() => setTab(value)}
                          onKeyDown={(event) => navigateTabs(event, value)}
                          key={value}
                        >
                          {value === 'details'
                            ? 'Report details'
                            : value === 'evidence'
                              ? 'Evidence'
                              : 'Preview'}
                          {value === 'evidence' && (
                            <span>
                              {events.length + (draft.screenshot ? 1 : 0)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    <button
                      className="text-button danger"
                      disabled={disabled}
                      onClick={() => setConfirm('delete')}
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                  {state.active && (
                    <div className="edit-hint">
                      <Circle size={12} fill="currentColor" />
                      <span>
                        Stop capture to edit and export. You can take
                        screenshots while collecting.
                      </span>
                    </div>
                  )}
                  {dirty && (
                    <div className="save-bar">
                      <span>Unsaved changes · privacy review reset</span>
                      <button
                        className="button primary small"
                        disabled={editingDisabled}
                        onClick={() => void save()}
                      >
                        <Check size={14} />
                        Save changes
                      </button>
                    </div>
                  )}
                  <div
                    id={`panel-${tab}`}
                    role="tabpanel"
                    aria-labelledby={`tab-${tab}`}
                  >
                    {tab === 'details' && (
                      <ReportDetails
                        draft={draft}
                        disabled={editingDisabled}
                        edit={edit}
                      />
                    )}
                    {tab === 'evidence' && (
                      <EvidencePanel
                        draft={draft}
                        editingDisabled={editingDisabled}
                        disabled={disabled}
                        edit={edit}
                        onScreenshot={screenshot}
                      />
                    )}
                    {tab === 'preview' && (
                      <>
                        <AIDiagnosticPanel
                          report={draft}
                          active={state.active}
                          dirty={dirty}
                          disabled={disabled}
                          edit={edit}
                          onUpdated={(next) => accept(next)}
                          onOpenSettings={() => setSettings(true)}
                        />
                        <section className="panel preview-panel">
                          <div className="panel-heading">
                            <div>
                              <h2>Markdown preview</h2>
                              <p>
                                Portable, readable context. ZIP includes the
                                approved screenshot.
                              </p>
                            </div>
                            <FileText size={20} className="muted" />
                          </div>
                          <pre className="markdown-preview">
                            {markdownPreview(draft)}
                          </pre>
                        </section>
                      </>
                    )}
                  </div>
                  <section className="panel export-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Ready to share the context?</h2>
                        <p>
                          Downloads stay on your computer. Share them yourself
                          when ready.
                        </p>
                      </div>
                      <ArrowDownToLine size={21} className="accent" />
                    </div>
                    <label className="review-checkbox">
                      <input
                        type="checkbox"
                        checked={draft.privacyReviewed}
                        disabled={editingDisabled || dirty}
                        onChange={(event) => {
                          void run(
                            {
                              type: 'UPDATE_REPORT',
                              report: {
                                ...draft,
                                privacyReviewed: event.target.checked,
                              },
                            },
                            'Saving privacy review',
                          );
                        }}
                      />
                      <span>
                        <strong>
                          I reviewed the report and screenshot for private
                          information.
                        </strong>
                        <small>
                          Review error text, URLs, reproduction steps, and every
                          visible screenshot area.
                        </small>
                      </span>
                    </label>
                    <div className="export-buttons">
                      <button
                        className="button secondary"
                        disabled={!exportReady}
                        onClick={() => exportReport('markdown')}
                      >
                        <FileText size={16} />
                        Markdown
                      </button>
                      <button
                        className="button secondary"
                        disabled={!exportReady}
                        onClick={() => exportReport('json')}
                      >
                        <FileJson size={16} />
                        JSON
                      </button>
                      <button
                        className="button primary"
                        disabled={!exportReady}
                        onClick={() => exportReport('zip')}
                      >
                        <FolderArchive size={16} />
                        Export ZIP
                        <ArrowDownToLine size={14} />
                      </button>
                    </div>
                    <p className="export-note">
                      {state.active
                        ? 'Stop capture before reviewing and exporting.'
                        : dirty
                          ? 'Save your changes, then complete the privacy review to enable export.'
                          : !draft.privacyReviewed
                            ? 'Complete the privacy review to enable export.'
                            : draft.screenshot
                              ? 'ZIP contains report.md, report.json, and screenshot.png. Standalone reports reference the image.'
                              : 'ZIP contains report.md and report.json. No screenshot attached.'}
                    </p>
                  </section>
                </>
              )}
            </>
          )}
          <footer className="content-footer">
            <span>
              BugCapsule <span className="footer-dot">·</span> Built for better
              bug reports.
            </span>
            <span>
              <LockKeyhole size={11} />
              No data leaves this browser automatically
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
