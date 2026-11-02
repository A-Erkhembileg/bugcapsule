import type { Report } from '../shared/types';
export type EditReport = (update: (current: Report) => Report) => void;

export function ReportDetails({
  draft,
  disabled,
  edit,
}: {
  draft: Report;
  disabled: boolean;
  edit: EditReport;
}) {
  function updateField<K extends keyof Report>(key: K, value: Report[K]) {
    edit((current) => ({ ...current, [key]: value }));
  }
  return (
    <>
      <section className="panel form-panel">
        <div className="section-kicker">
          <span>01</span> THE ISSUE
        </div>
        <label>
          Bug title
          <input
            data-testid="report-title"
            value={draft.title}
            placeholder="A concise summary of what went wrong"
            maxLength={200}
            disabled={disabled}
            onChange={(event) => updateField('title', event.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            value={draft.description}
            placeholder="What were you trying to do? Add any useful context."
            rows={3}
            maxLength={10000}
            disabled={disabled}
            onChange={(event) => updateField('description', event.target.value)}
          />
        </label>
        <div className="field-grid">
          <label>
            Expected behavior
            <textarea
              value={draft.expectedBehavior}
              placeholder="What should have happened?"
              rows={3}
              maxLength={5000}
              disabled={disabled}
              onChange={(event) =>
                updateField('expectedBehavior', event.target.value)
              }
            />
          </label>
          <label>
            Actual behavior
            <textarea
              value={draft.actualBehavior}
              placeholder="What happened instead?"
              rows={3}
              maxLength={5000}
              disabled={disabled}
              onChange={(event) =>
                updateField('actualBehavior', event.target.value)
              }
            />
          </label>
        </div>
      </section>
      <section className="panel form-panel">
        <div className="section-kicker">
          <span>02</span> HOW TO REPRODUCE
        </div>
        <label>
          Reproduction steps
          <span className="label-hint">
            One step per line. Do not include passwords or private data.
          </span>
          <textarea
            data-testid="reproduction-steps"
            value={draft.steps.join('\n')}
            placeholder={
              'Open the affected page\nClick the action that triggers the issue\nObserve the unexpected result'
            }
            rows={4}
            maxLength={10000}
            disabled={disabled}
            onChange={(event) =>
              updateField('steps', event.target.value.split('\n'))
            }
          />
        </label>
      </section>
      <section className="panel form-panel">
        <div className="section-kicker">
          <span>03</span> ENVIRONMENT
        </div>
        <p className="section-description">
          Review these details. Clear text fields that you don’t want to share.
        </p>
        <label>
          Page URL
          <input
            value={draft.environment.url}
            disabled={disabled}
            onChange={(event) =>
              edit((current) => ({
                ...current,
                environment: {
                  ...current.environment,
                  url: event.target.value,
                },
              }))
            }
          />
        </label>
        <label>
          Browser
          <input
            value={draft.environment.browser}
            disabled={disabled}
            onChange={(event) =>
              edit((current) => ({
                ...current,
                environment: {
                  ...current.environment,
                  browser: event.target.value,
                },
              }))
            }
          />
        </label>
        <div className="environment-grid">
          <label>
            Viewport width
            <input
              type="number"
              min="1"
              max="16384"
              value={draft.environment.viewport.width}
              disabled={disabled}
              onChange={(event) =>
                edit((current) => ({
                  ...current,
                  environment: {
                    ...current.environment,
                    viewport: {
                      ...current.environment.viewport,
                      width: Number(event.target.value) || 1,
                    },
                  },
                }))
              }
            />
          </label>
          <label>
            Viewport height
            <input
              type="number"
              min="1"
              max="16384"
              value={draft.environment.viewport.height}
              disabled={disabled}
              onChange={(event) =>
                edit((current) => ({
                  ...current,
                  environment: {
                    ...current.environment,
                    viewport: {
                      ...current.environment.viewport,
                      height: Number(event.target.value) || 1,
                    },
                  },
                }))
              }
            />
          </label>
          <label>
            Pixel ratio
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={draft.environment.viewport.devicePixelRatio}
              disabled={disabled}
              onChange={(event) =>
                edit((current) => ({
                  ...current,
                  environment: {
                    ...current.environment,
                    viewport: {
                      ...current.environment.viewport,
                      devicePixelRatio: Number(event.target.value) || 1,
                    },
                  },
                }))
              }
            />
          </label>
          <label>
            Language
            <input
              value={draft.environment.language}
              disabled={disabled}
              onChange={(event) =>
                edit((current) => ({
                  ...current,
                  environment: {
                    ...current.environment,
                    language: event.target.value,
                  },
                }))
              }
            />
          </label>
        </div>
      </section>
    </>
  );
}
