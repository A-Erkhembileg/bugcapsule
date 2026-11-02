# Architecture

BugCapsule is a TypeScript/React Manifest V3 extension built with Vite and CRXJS. The included demo is a separate static local HTTP server. There is no application server or database.

```text
Toolbar popup / full editor (React)
          | validated commands, trusted extension origin
          v
Background service worker -- session storage (report, channel, document ID)
          | chrome.scripting.executeScript after Start
          +--> ISOLATED bridge --> runtime messages --> worker validation
          +--> MAIN instrumentation --> sanitized postMessage --> bridge

Stopped report --> edits --> save --> explicit review --> local MD / JSON / ZIP
                       |
                       +--> optional payload preview --> per-request consent
                            --> Gemini --> validated diagnostic --> new review
```

## Modules

| Path | Responsibility |
| --- | --- |
| `src/background/` | Serialized capture state machine, API authorization, tab lifecycle, screenshots, session storage |
| `src/content/bridge.ts` | Isolated-world relay; safe optional click and navigation listeners |
| `src/page/instrumentation.ts` | Main-world console wrapper and runtime error/rejection listeners |
| `src/core/` | Bounded redaction, Zod schemas, normalization, serialization, archive generation |
| `src/shared/types.ts` | Shared report and UI state contracts |
| `src/ui/` | React dashboard, editor, image redaction, previews and local downloads |
| `src/ai/` | Evidence selection, versioned prompt, provider content schema and genuine event-reference checks |
| `src/services/aiDiagnostic.ts` | BYOK storage and compatibility exports for the diagnostic service |
| `src/services/geminiTransport.ts` | Fixed-origin structured Gemini request, bounded response, retry and cancellation handling |
| `src/services/aiConfiguration.ts` | Supported model allowlist and explicit retry policy |
| `src/services/aiCoordinator.ts` | Trusted commands, API-key storage, request consent and diagnostic lifecycle |
| `src/core/import.ts` | JSON restoration, legacy normalization and guarded internal PNG import |
| `public/report.schema.json` | JSON Schema for exported report versions 1.0.0, 1.1.0 and 1.2.0 |
| `tests/unit/` | Core, instrumentation and background-controller verification |
| `tests/e2e/` | Production-bundle Chromium workflow and permission checks |
| `demo/` | Intentionally buggy, synthetic demonstration page |
| `eval/` | Reproducible defects, evidence collection, A/B runs and separate human-review tooling |

## Capture lifecycle

Opening the toolbar popup grants temporary `activeTab` access. Pressing Start initiates collection in the active HTTP(S) tab's main frame. The worker installs the isolated bridge and receives Chrome's document ID. It uses that ID to target the same document when installing main-world instrumentation. The toolbar badge reads `REC` while capture is active.

The main-world console wrapper calls the original method with its original receiver and arguments. It observes primitive arguments and own Error data fields without traversing objects or reading accessor properties. It subscribes to `error` and `unhandledrejection`. The isolated bridge validates bounded messages and forwards them through `chrome.runtime`. The worker checks sender extension ID, tab, top frame, document ID, session channel, schema, deadline, and event count before recording. Page scripts can see the channel and forge diagnostic events.

The popup and full editor send commands from the same packaged `index.html`. The worker accepts only the extension's own sender ID and top-level editor URL. Worker mutations share one promise queue. The report, session channel, and document ID persist in `chrome.storage.session` with access restricted to trusted extension contexts. On restart, the worker checks the deadline and probes the original isolated bridge before accepting further events. A restored report remains available for editing if the bridge has disappeared. Page-side deadlines end collection while the worker sleeps. Its badge can lag until the next wakeup.

When the user confirms replacement of a stopped report, the editor sends the report ID with Start. The worker verifies that the ID still matches. It commits the replacement after installing both observers and setting the badge. A denied injection, failed badge update, or storage error leaves the prior report intact, and the worker removes any partial installation. Other draft and screenshot writes also update in-memory state only after session storage succeeds.

Stop rejects subsequent events before removing listeners and wrappers. Navigation and tab removal end capture. Cleanup preserves console wrappers subsequently installed by the page. If Chrome revokes access before cleanup, the old document is destroyed or the page-side deadline removes the observers. Users start a new capture for the next document. The optional timeline observes `hashchange` and `popstate` events. Direct `pushState` calls are outside its coverage.

Chrome's screenshot API takes a window ID and returns pixels from its active tab. Before and after capture, the worker checks the active tab and probes its visible top document to compare Chrome's document ID. Temporary activation and navigation listeners detect switches during the request. The worker discards the returned image when these checks fail. Screenshot capture remains available after Stop while the original document is active.

## Storage and limits

One report is retained per browser session. Browser shutdown, extension disable/reload/update, or Delete all data clears it. Theme and model/retry preferences persist locally. The optional Gemini API key defaults to trusted session storage, with explicit opt-in device persistence in `chrome.storage.local`. Both storage areas restrict access to trusted extension contexts and remain unencrypted. An explicitly approved diagnostic transmits the selected text to Google under Google's data-use terms.

Limits: 15 minutes; 200 total events; up to 20 events/second at page and bridge boundaries; 2,000 message characters; 4,000 stack characters; 2,000,000 characters per screenshot data URL. Zod also bounds form fields, dimensions, arrays, timestamps, and input envelopes. Rate-limited events may be omitted without a count; reaching the worker event limit stops capture. Screenshots over the limit are rejected with an instruction to reduce the window size.

## Report and export

The internal draft contains a PNG data URL. The portable JSON schema represents an attachment by filename and metadata; no base64 appears in standalone JSON. Markdown is escaped to prevent page-controlled HTML/images or active links from being injected into the report. A ZIP contains `report.md`, `report.json`, and optionally `screenshot.png`. Files have a fixed ordering and ZIP timestamp; identical report inputs yield identical archive bytes. Determinism applies to a given report, not separate sessions with different IDs and timestamps.

Editing is allowed only while stopped. Changing content invalidates privacy review; reviewing is a separate update after saving. Exports revalidate and sanitize the saved report and require approval. Screenshot rectangles are rendered as opaque black pixels into a replacement PNG, not reversible CSS overlays. No image-recognition redaction is claimed.

New reports use schema version `1.2.0` with an optional structured diagnostic. Its provenance includes analysis/report identity, provider, model, prompt version, generation time and supplied evidence IDs. The provider generates content fields only. The caller assigns provenance after schema and reference validation. Legacy `1.0.0` and `1.1.0` reports remain supported, including historical string analyses capped at 12,000 characters. Unrecorded legacy metadata remains unknown. Ordinary older reports retain their version on export, while structured analysis normalizes the report to `1.2.0`.

Structured Markdown includes observations, hypotheses, genuine event IDs, conditional fixes, verification steps, missing evidence and limitations. Generated prose is escaped. Legacy free-form analysis is fenced as text. JSON Schema describes structural constraints, while runtime validation additionally checks report identity, event uniqueness and cross-field reference membership.

JSON import validates the internal or portable report, reapplies sanitation and resets review. Metadata-only image references are dropped because no bytes were supplied. Internal PNG bytes must have a valid PNG/IHDR header, dimensions matching their metadata and at most sixteen million decoded pixels before the UI receives the image. The original screenshot capture path retains its existing limits. Imported reports do not silently start capture.

## Optional Gemini diagnostic

The extension preserves its standard `fetch` path against Gemini `generateContent`, configured for JSON output and a response JSON schema. The default lightweight `gemini-3.5-flash-lite` and alternative `gemini-3.8-flash` are explicitly selectable. There is no automatic model fallback. This small native transport fits MV3 without a provider SDK or remote code loader. Details and provider references are in [AI diagnostics](AI_DIAGNOSTICS.md).

The preparation step selects bounded, high-signal evidence and groups repeated errors. It retains the actual report ID, event IDs, grouped aliases and first-occurrence timestamps. Screenshot bytes, previous AI output and authentication credentials are omitted. The user sees the exact JSON text before approving transmission. A fingerprint binds consent to the evidence, model, prompt version and retry policy. Edits require renewed review and invalidate stale results.

Google host access is an optional origin permission requested at the explicit send action. The extension CSP allows network connections only to that origin. The worker reads the key from trusted extension storage and uses an authentication header, so it does not appear in the endpoint URL or report exports. The settings UI returns key-presence status rather than the stored key. No `VITE_GEMINI_API_KEY` build-time secret is used.

Requests have progress, cancellation and failure states. Retries default off. Explicit opt-in allows at most two additional attempts for transient failures, using exponential backoff, jitter and bounded `Retry-After` delays. Authentication/model errors are not retried, and waits exceeding the deadline return an error for later manual action. Raw provider error text is never surfaced. Prompt `2.0.0` treats page content as untrusted evidence, separates observation from inference, requires real supplied event IDs and prohibits claims of verified fixes. Invalid JSON, extra properties, fabricated references and incomplete output are rejected. React components render the validated fields as text and never execute generated code.

Diagnostic payloads are capped at 24,000 characters, generated content at 48,000, and response bodies at 196,608 bytes. At most twelve distinct error groups and a reduced generic timeline are selected. Low-signal steps/events may be omitted for the JSON budget. A 25-second deadline covers the operation and any retries. The worker permits one operation at a time and stores a cooldown, extended when a quota response requires it. Key mutations share a queue, delete-all waits for earlier key writes, and cancellation is checked inside the result commit queue.

Pending metadata is saved before transmission and updated with attempt counts. On worker restart a previous running job becomes interrupted, with no automatic resend. A saved report remains usable locally. Provider usage metadata, when present, refers to the final successful response. It does not account for unknown usage in failed retry attempts. The A/B evaluation and human-review workflow is documented separately in [evaluation](EVALUATION.md).

## Dependencies

React/React DOM render the UI; Lucide supplies local SVG icons; Zod validates untrusted boundaries; fflate builds ZIPs in the browser. Vite/CRXJS bundle MV3 entrypoints; Tailwind supplies CSS utilities. Vitest/jsdom test local logic; Playwright runs real browser tests; Ajv independently validates the published JSON Schema. All code and assets are bundled. Gemini is an optional remote service. The local capture-to-export workflow requires no CDN or runtime service.

## Extension points

Exports are pure functions behind the core module. Future approved integrations can consume the versioned portable report. Remote transports remain separate from capture and require a review/consent step. Video requires its own permission and retention design. Team sharing, issue submission, deduplication and video remain roadmap items.
