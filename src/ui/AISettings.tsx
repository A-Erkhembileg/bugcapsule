import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import { aiRequest } from './api';
import type { AIStatus } from './api';
import type { AiModel } from '../ai/schema';

export function AISettings({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [model, setModel] = useState<AiModel>('gemini-3.5-flash-lite');
  const [allowRetries, setAllowRetries] = useState(false);

  useEffect(() => {
    let alive = true;
    void aiRequest<AIStatus>({ type: 'GET_AI_STATUS' })
      .then((next) => {
        if (alive) {
          setStatus(next);
          setRemember(next.settings.remembered);
          setModel(next.configuration?.model ?? 'gemini-3.5-flash-lite');
          setAllowRetries(next.configuration?.allowRetries ?? false);
        }
      })
      .catch((cause) => {
        if (alive)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load AI settings.',
          );
      });
    return () => {
      alive = false;
    };
  }, []);

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim() || disabled || working) return;
    setWorking(true);
    setError('');
    setFeedback('');
    try {
      const next = await aiRequest<AIStatus>({
        type: 'SET_AI_KEY',
        apiKey: apiKey.trim(),
        remember,
      });
      setStatus(next);
      setApiKey('');
      setFeedback(
        remember
          ? 'Key saved on this device.'
          : 'Key saved for this browser session.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save the key.',
      );
    } finally {
      setWorking(false);
    }
  }

  async function removeKey() {
    setWorking(true);
    setError('');
    setFeedback('');
    try {
      setStatus(await aiRequest<AIStatus>({ type: 'REMOVE_AI_KEY' }));
      setApiKey('');
      setRemember(false);
      setFeedback('API key removed. Any running diagnostic was canceled.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not remove the key.',
      );
    } finally {
      setWorking(false);
    }
  }

  async function saveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || working || status?.running) return;
    setWorking(true);
    setError('');
    setFeedback('');
    try {
      const next = await aiRequest<AIStatus>({
        type: 'SET_AI_CONFIG',
        model,
        allowRetries,
      });
      setStatus(next);
      setModel(next.configuration.model);
      setAllowRetries(next.configuration.allowRetries);
      setFeedback(
        'AI configuration saved. Review the model and request limit before each send.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save the AI configuration.',
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      className="panel ai-settings"
      aria-labelledby="ai-settings-heading"
    >
      <div className="panel-heading">
        <div>
          <h2 id="ai-settings-heading">Optional AI diagnostics</h2>
          <p>
            Use your own Gemini API key to analyze a report you explicitly
            approve.
          </p>
        </div>
        <KeyRound size={21} className="accent" />
      </div>
      <p className="ai-settings-copy">
        The capture and export workflow works without a key. AI requests send
        reviewed text to Google. Free-tier inputs and outputs may be used to
        improve Google products, and quota availability depends on your account.
      </p>
      <a
        className="text-button ai-external-link"
        href="https://aistudio.google.com/apikey"
        target="_blank"
        rel="noreferrer"
      >
        Create or manage a Gemini API key
        <ExternalLink size={13} />
      </a>
      {status && (
        <p className="ai-key-status" role="status">
          {status.settings.hasKey
            ? status.settings.remembered
              ? 'A key is saved on this device.'
              : 'A key is set for this browser session.'
            : 'No API key is set.'}
          {status.model && <span>Model · {status.model}</span>}
        </p>
      )}
      {error && (
        <p className="notice error-notice" role="alert">
          {error}
        </p>
      )}
      {feedback && (
        <p className="notice success-notice" role="status">
          {feedback}
        </p>
      )}
      <form onSubmit={(event) => void saveKey(event)}>
        <label className="ai-key-label" htmlFor="gemini-api-key">
          Gemini API key
          <input
            id="gemini-api-key"
            type="password"
            value={apiKey}
            disabled={disabled || working}
            autoComplete="off"
            spellCheck={false}
            placeholder={
              status?.settings.hasKey
                ? 'Enter a replacement key'
                : 'Paste your own API key'
            }
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <label className="check-label ai-remember-label">
          <input
            type="checkbox"
            checked={remember}
            disabled={disabled || working}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span>Remember the key on this device</span>
        </label>
        <p className="ai-storage-note">
          Keys stay in trusted extension storage and are excluded from reports.
          Session storage is the default. Remembered keys use Chrome local
          storage, which is not encrypted secret storage. Anyone controlling
          your browser or device may access them.
        </p>
        <div className="button-row">
          <button
            className="button primary"
            type="submit"
            disabled={disabled || working || !apiKey.trim()}
          >
            {working ? 'Updating key…' : 'Save API key'}
          </button>
          {status?.settings.hasKey && (
            <button
              className="button secondary"
              type="button"
              disabled={disabled || working}
              onClick={() => void removeKey()}
            >
              <Trash2 size={14} />
              Remove API key
            </button>
          )}
        </div>
      </form>
      <form
        className="ai-configuration"
        onSubmit={(event) => void saveConfiguration(event)}
      >
        <h3>Diagnostic configuration</h3>
        <label className="ai-key-label" htmlFor="gemini-model">
          Gemini model
          <select
            id="gemini-model"
            value={model}
            disabled={disabled || working || status?.running}
            onChange={(event) => setModel(event.target.value as AiModel)}
          >
            <option value="gemini-3.5-flash-lite">
              Gemini 3.5 Flash-Lite · lightweight
            </option>
            <option value="gemini-3.8-flash">
              Gemini 3.8 Flash · complex diagnostics
            </option>
          </select>
        </label>
        <p className="ai-storage-note">
          Model availability, quotas and pricing depend on your Google project.
          A billing-enabled key may incur charges. ReproQuill uses the selected
          model and never switches models automatically.
        </p>
        <label className="check-label ai-remember-label">
          <input
            type="checkbox"
            checked={allowRetries}
            disabled={disabled || working || status?.running}
            onChange={(event) => setAllowRetries(event.target.checked)}
          />
          <span>Allow up to two retries for transient failures</span>
        </label>
        <p className="ai-storage-note">
          Retries use bounded exponential backoff and jitter within the request
          deadline. Each additional attempt can consume quota or incur charges.
          Authentication and malformed-response failures are not retried. This
          setting starts disabled and is disclosed again before sending.
        </p>
        {status?.running && (
          <p className="ai-hint">
            Wait for the running diagnostic or cancel it before changing
            configuration.
          </p>
        )}
        <button
          className="button secondary"
          type="submit"
          disabled={disabled || working || status?.running}
        >
          Save AI configuration
        </button>
      </form>
    </section>
  );
}
