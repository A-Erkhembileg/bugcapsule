import { Fingerprint, Trash2 } from 'lucide-react';
import { AISettings } from './AISettings';

export function PrivacySettings({
  disabled,
  onDelete,
}: {
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <>
      <AISettings disabled={disabled} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Privacy, with clear boundaries</h2>
            <p>Collection starts only when you press Start capture.</p>
          </div>
          <Fingerprint size={23} className="accent" />
        </div>
        <div className="privacy-grid">
          <div>
            <h3>What can be captured</h3>
            <ul>
              <li>
                New console errors, JavaScript errors, and unhandled promise
                rejections.
              </li>
              <li>
                Basic browser, viewport, language, and a sanitized page URL.
              </li>
              <li>
                Optional clicks described only by element tag, plus
                same-document navigation.
              </li>
              <li>The visible tab screenshot, only when you request one.</li>
            </ul>
          </div>
          <div>
            <h3>What we leave out</h3>
            <ul>
              <li>
                No keystrokes, form values, DOM text, cookies, or network
                request bodies.
              </li>
              <li>
                No history before you start. No other tabs or embedded frames.
              </li>
              <li>
                No BugCapsule account, cloud report storage, or third-party
                analytics. AI diagnostics are an explicit optional action.
              </li>
              <li>No automatic screenshots or uploads.</li>
            </ul>
          </div>
        </div>
      </section>
      <section className="panel prose-panel">
        <h2>Review is still essential</h2>
        <p>
          Known credential patterns and email addresses are redacted from
          captured messages. URL queries, fragments, and embedded credentials
          are removed. These rules cannot recognize every secret, personal
          detail, or sensitive path.
        </p>
        <p>
          Page error text is untrusted and may contain private information. Edit
          or remove events and environment fields, then manually redact
          screenshot pixels before exporting. A webpage can interfere with
          instrumentation or forge diagnostic events.
        </p>
        <h3>One document at a time</h3>
        <p>
          Capture stops on a page reload, navigation, tab close, or after the
          capture time limit. Same-document navigation may be recorded when the
          timeline is enabled. Start again from the extension on the destination
          page.
        </p>
        <h3>Session-local storage</h3>
        <p>
          The current capture is held in Chrome session storage and survives the
          extension popup closing. It is cleared when the browser session ends
          or the extension reloads. Export a report you want to keep. Theme
          preference and an API key you choose to remember are the only
          persistent settings.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Minimal permissions</h2>
            <p>No persistent access to all websites.</p>
          </div>
        </div>
        <dl className="permission-list">
          <div>
            <dt>activeTab</dt>
            <dd>
              Temporary access to the tab where you invoke the extension,
              including an explicit screenshot.
            </dd>
          </div>
          <div>
            <dt>scripting</dt>
            <dd>Install and remove collection code after you start capture.</dd>
          </div>
          <div>
            <dt>storage</dt>
            <dd>Hold your current report locally for the browser session.</dd>
          </div>
          <div>
            <dt>Google API</dt>
            <dd>
              Optional access to generativelanguage.googleapis.com, requested
              only when you approve sending a diagnostic. Website capture
              remains scoped to activeTab.
            </dd>
          </div>
        </dl>
      </section>
      <section className="panel danger-panel">
        <div>
          <h2>Clear your workspace</h2>
          <p>
            Stop capture and remove report data, diagnostics, and saved API
            keys.
          </p>
        </div>
        <button
          className="button danger-outline"
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash2 size={16} />
          Delete all data
        </button>
      </section>
    </>
  );
}
