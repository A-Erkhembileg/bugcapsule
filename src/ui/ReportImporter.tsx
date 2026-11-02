import { useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { restorePortableReport } from '../core/import';
import type { Report } from '../shared/types';

const MAX_IMPORT_BYTES = 2_000_000;

export function ReportImporter({
  disabled,
  hasReport,
  onImport,
}: {
  disabled: boolean;
  hasReport: boolean;
  onImport: (report: Report) => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  async function read(file: File | undefined) {
    if (!file) return;
    setError('');
    setPending(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setError('Choose a JSON report smaller than 2 MB.');
      return;
    }
    try {
      setPending(restorePortableReport(JSON.parse(await file.text())));
    } catch {
      setError(
        'This file is not a supported BugCapsule report. Check its version, field limits and diagnostic evidence references.',
      );
    }
  }

  async function apply() {
    if (!pending || disabled || working) return;
    setWorking(true);
    try {
      if (await onImport(pending)) setPending(null);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="report-importer">
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Choose BugCapsule report JSON"
        data-testid="report-import-file"
        hidden
        onChange={(event) => {
          void read(event.target.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      <button
        className="text-button"
        disabled={disabled || working}
        onClick={() => input.current?.click()}
      >
        <FileUp size={14} />
        Import JSON
      </button>
      {error && (
        <p className="notice error-notice" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss import error"
            onClick={() => setError('')}
          >
            <X size={13} />
          </button>
        </p>
      )}
      {pending && (
        <div
          className="confirmation import-confirmation"
          role="region"
          aria-label="Confirm report import"
        >
          <div>
            <strong>
              {hasReport
                ? 'Replace the current report with this import?'
                : 'Open this report locally?'}
            </strong>
            <p>
              {pending.title || 'Untitled bug report'} · {pending.events.length}{' '}
              captured events · schema {pending.schemaVersion}
            </p>
            <p>
              {hasReport
                ? 'The current report and any unsaved edits will be replaced after validation succeeds. '
                : ''}
              Imported reports require a fresh privacy review. Importing does
              not send data to an AI provider.
            </p>
            {!pending.screenshot && (
              <p>
                Screenshot metadata in standalone JSON does not contain image
                pixels. Keep the original screenshot file separately.
              </p>
            )}
          </div>
          <div className="button-row">
            <button
              className="button secondary"
              disabled={working}
              onClick={() => setPending(null)}
            >
              Cancel import
            </button>
            <button
              className="button primary"
              disabled={disabled || working}
              onClick={() => void apply()}
            >
              {working ? 'Importing…' : 'Import report'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
