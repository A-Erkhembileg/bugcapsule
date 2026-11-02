import type { Report } from '../shared/types';
import type { EditReport } from './ReportDetails';
import { ScreenshotEditor } from './ScreenshotEditor';
import { Camera, Terminal, Trash2 } from 'lucide-react';
import { isDiagnostic } from './diagnostics';

export function EvidencePanel({
  draft,
  editingDisabled,
  disabled,
  edit,
  onScreenshot,
}: {
  draft: Report;
  editingDisabled: boolean;
  disabled: boolean;
  edit: EditReport;
  onScreenshot: () => void;
}) {
  const events = draft.events;
  function updateField<K extends keyof Report>(key: K, value: Report[K]) {
    edit((current) => ({ ...current, [key]: value }));
  }
  return (
    <>
      {draft.screenshot ? (
        <ScreenshotEditor
          screenshot={draft.screenshot}
          disabled={editingDisabled}
          onChange={(value) => updateField('screenshot', value)}
          onRetake={onScreenshot}
          onRemove={() =>
            edit((current) => {
              const next = { ...current };
              delete next.screenshot;
              return next;
            })
          }
        />
      ) : (
        <section className="panel screenshot-empty">
          <Camera size={25} />
          <div>
            <h2>Give the issue a visual reference.</h2>
            <p>Return to the affected tab and use Screenshot in the popup.</p>
          </div>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={onScreenshot}
          >
            Take screenshot
          </button>
        </section>
      )}
      <section className="panel events-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Captured events{' '}
              <span className="count-label">{events.length}</span>
            </h2>
            <p>
              Untrusted page diagnostics. Edit or remove any sensitive details.
            </p>
          </div>
          {events.length > 0 && (
            <button
              className="text-button danger"
              disabled={editingDisabled}
              onClick={() => updateField('events', [])}
            >
              Clear events
            </button>
          )}
        </div>
        {events.length === 0 ? (
          <div className="events-empty">
            <Terminal size={23} />
            <p>No events captured yet.</p>
            <span>
              Only errors generated after capture starts can appear here.
            </span>
          </div>
        ) : (
          <ol className="event-list">
            {events.map((event, index) => (
              <li key={event.id} className="event-item">
                <div className="event-meta">
                  <span
                    className={
                      isDiagnostic(event.kind)
                        ? 'event-kind error-kind'
                        : 'event-kind'
                    }
                  >
                    {event.kind}
                  </span>
                  <time dateTime={event.timestamp}>
                    +{(event.offsetMs / 1000).toFixed(2)}s
                  </time>
                  <button
                    className="icon-button danger"
                    title="Remove event"
                    aria-label={`Remove event ${index + 1}`}
                    disabled={editingDisabled}
                    onClick={() =>
                      updateField(
                        'events',
                        events.filter((item) => item.id !== event.id),
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <label className="sr-only" htmlFor={`event-${event.id}`}>
                  Event {index + 1} message
                </label>
                <textarea
                  id={`event-${event.id}`}
                  className="event-message"
                  value={event.message}
                  rows={2}
                  maxLength={2000}
                  disabled={editingDisabled}
                  onChange={(change) =>
                    updateField(
                      'events',
                      events.map((item) =>
                        item.id === event.id
                          ? { ...item, message: change.target.value }
                          : item,
                      ),
                    )
                  }
                />
                {(event.source || event.stack || event.line !== undefined) && (
                  <details className="event-details">
                    <summary>Location & stack</summary>
                    <label>
                      Script location
                      <input
                        value={event.source ?? ''}
                        disabled={editingDisabled}
                        onChange={(change) =>
                          updateField(
                            'events',
                            events.map((item) =>
                              item.id === event.id
                                ? { ...item, source: change.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    {event.line !== undefined && (
                      <p>
                        Line {event.line}
                        {event.column !== undefined
                          ? `, column ${event.column}`
                          : ''}
                      </p>
                    )}
                    <label>
                      Stack trace
                      <textarea
                        value={event.stack ?? ''}
                        rows={3}
                        maxLength={4000}
                        disabled={editingDisabled}
                        onChange={(change) =>
                          updateField(
                            'events',
                            events.map((item) =>
                              item.id === event.id
                                ? { ...item, stack: change.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
