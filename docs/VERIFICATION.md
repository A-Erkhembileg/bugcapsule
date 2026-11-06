# Verification record

## ReproQuill branding refresh

Verified on 2026-11-06. Source lint, strict TypeScript, the production build, 116 unit tests, and 6 browser tests passed. The browser run used a temporary Chrome profile and synthetic demo data to refresh the screenshots in `docs/images/`. The local package is `release/reproquill-0.3.0.zip`.

## v0.3.0 structured-engine finalization

The first public Linux CI runs exposed a privacy-review checkbox that briefly reversed its state while awaiting the worker's save response. The UI now acknowledges the click immediately while export remains disabled until the saved state is confirmed. The regression test deliberately delays that save by 300 ms. The corrected build passed all 6 browser tests locally. [Current GitHub Actions results](https://github.com/Yamiakumi/reproquill/actions/workflows/ci.yml)

Verified on 2026-11-02 in the Windows/Node/pnpm/Chrome environment below. The final unit suite passed **116 tests across 7 files**. Lint, strict TypeScript and production build passed. The final real-extension Playwright run passed **6 browser tests** against v0.3.0. These cover structured response/provenance/evidence display, model and retry consent, rate limits, capture/redaction/export, deletion/repeat and legacy JSON import. AI responses and native Google permission approval are mocked explicitly; the ordinary capture/browser APIs are real.

The benchmark executed **25 intentional defects, all 25 reproduced**, then **50 A/B mock records, all 50 schema-valid**, with zero provider calls and no human quality grades. The review command generated 50 ungraded rows. These results establish mechanical protocol behavior, rather than Gemini accuracy. Mock API latency, token usage and estimated cost remain null. See [evaluation methodology](EVALUATION.md) and `eval/examples/finalization-mock-summary.json` for exact commands and machine-readable results.

Independent review identified two additional cleanup edges that were repaired: cancelling HTTP error response bodies before retry, and preventing cancellation/deletion from intentionally recreating a quota cooldown. A regression verifies body cleanup. Credential audits, version migrations, import image limits, evidence-reference rejection, retry jitter and worker interruption are covered by the audit and test suites.

Manual live-provider approval and native permission checks remain listed below; no real Google request, model-quality score or paid usage is claimed. [Engineering handoff](ENGINEERING_HANDOFF.md).

The following sections retain the earlier release baselines for traceability. The v0.3.0 results above supersede their counts and free-form response scope.

## AI upgrade verification

The final v0.2.0 production build was verified on 2026-11-01 using the Windows, Node, pnpm and Chrome environment listed below. `pnpm check` passed lint with zero warnings, strict TypeScript, **81 unit tests across 5 suites**, and the production build. The full browser suite passed **4 tests** against the final unpacked extension.

Two browser tests exercise real local capture and export. Two exercise the actual AI settings, report preview and export UI with **test-only mocked Gemini responses and mocked optional-permission approval**. They verify no send before consent, no send after denied permission or cancellation while permission is pending, exact approved payload transmission, exclusion of screenshots/keys/prior analysis, analysis review/export/removal, delete-all key removal and HTTP 429 handling without an automatic retry. The test fixtures and mock boundaries are confined to `tests/` and are excluded from the production bundle. Screenshots `ai-consent-mock.png` and `ai-result-mock.png` are visibly labeled as mock-provider demonstrations.

The service and coordinator unit tests also cover request/response size budgets, JSON escaping, error deduplication, known-key redaction, request timeout, AbortSignal cancellation, blocked/invalid provider responses, fingerprint mismatch, rate-limit persistence, overlapping key mutations and deletion, stale analysis, and rollback when cancellation occurs during a result storage write.

Chrome's native optional-host permission dialog remained pending in headless automation. The product still uses the native `chrome.permissions.request` flow. Manually approve that dialog in the live smoke test below. Its approval has not been claimed as an automated test pass.

No real Gemini request has been executed during this upgrade. No personal API key was supplied. Mocked provider responses can verify request construction, error handling, consent and UI behavior, but cannot establish the availability of a particular Google project or the quality of a live model response.

To run a live smoke test after the automated checks, create a personal key in Google AI Studio, enter it only in extension settings, capture a synthetic demo error, stop and save the report, then review and explicitly send the diagnostic payload. Confirm that a response appears and survives JSON/Markdown/ZIP export after a fresh privacy review. Check your Google project quotas and billing first. Do not paste the key into this repository, a report, a screenshot or a chat.

The production manifest now declares optional access to the Google API origin. Capture and local export retain their existing permissions and offline behavior. Optional Gemini transmission changes the earlier no-network scope described by the baseline below.

## Local MVP baseline

Verified locally on 2026-11-01 using Windows, Node.js 24.22.1, pnpm 11.25.0 and Chrome 156.0.8078.76. All reports, inputs and screenshots used synthetic demonstration data.

## Executed checks

The following table records the original v0.1.0 local-only baseline. The v0.2.0 results above supersede its test counts and add the optional Google host permission.

| Check | Result |
| --- | --- |
| `pnpm check` | Passed. Includes lint with zero warnings, strict TypeScript, Vitest and the production build |
| Vitest | 48 tests passed across 3 files |
| `pnpm test:e2e` with the installed Chrome override below | 2 tests passed against the final production build |
| Production manifest | Only `activeTab`, `scripting` and `storage`. No persistent host permissions or static content scripts |
| Exports | Standalone Markdown and JSON match their ZIP entries byte for byte. Exported screenshot was decoded separately and its redacted pixel verified as opaque black |
| Visual inspection | Actual dark/light report editor and screenshot-review images inspected. Screenshots are checked into `docs/images/` |
| Release packaging | Archive entries checked against the unpacked extension, with icons, MIT license and bundled dependency notices included |

At the time of this original baseline, the remote workflow had not run. GitHub Actions now runs the checks and browser tests on Linux; see the current publication note above. No Chrome Web Store submission, independent security audit, screen-reader test or macOS/Linux manual smoke test is claimed.

## Acceptance workflow

The real-extension browser suite starts the local demo server and loads the generated `dist/manifest.json` in a disposable browser profile. It uses Chrome's browser-target CDP commands to load the extension and invoke its toolbar action. Playwright does not expose the toolbar popup as an ordinary page, so the test invokes its actual rendered controls through Chrome's same-origin extension view. No permission is added to the production manifest for testing.

| MVP action | Executed evidence |
| --- | --- |
| Install unpacked extension | Production directory loaded by Chrome's unpacked-extension API |
| Open the included demo | Loopback HTTP server and demo page loaded |
| Start capture | Actual toolbar Start control, optional timeline and visible active status |
| Trigger an error | Uncaught error, unhandled promise rejection and console error all collected |
| Capture screenshot | Actual `captureVisibleTab` output attached |
| Write reproduction steps | Title, description, expected/actual behavior and three steps saved through the editor |
| Review and redact | Opaque image redaction applied, saved and explicitly reviewed. Exported pixels checked independently |
| Export a report | ZIP, JSON and Markdown downloaded and compared. Schema version and event kinds checked |
| Delete locally stored capture | Delete-all confirmation returns the workspace to its empty state |
| Repeat | Another capture records a new error, then stops on reload |

The suite also verifies keyboard tab activation/focus, both themes, restricted-page failure, omission of events before Start, omission of password input contents and console object fields, and redaction of sample secrets.

Unit tests independently cover normalization, bounds, credential redaction before the DOM bridge and again in the worker, JSON Schema validation with Ajv, deterministic export bytes, malformed messages, sender/document checks, start/stop, expiration and worker recovery, storage failure rollback, failed permission access, failed replacement preservation and screenshot target changes.

## Reproduce the checks

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
pnpm package
```

In this Windows environment, Playwright's downloaded Chrome for Testing failed to start with a side-by-side assembly loader error. The installed Chrome successfully ran the final suite in a fresh temporary profile. This PowerShell override reproduced that successful run.

```powershell
$env:BUGCAPSULE_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm test:e2e
```

Set `BUGCAPSULE_DOC_SCREENSHOTS=1` only when intentionally regenerating the documentation images from the synthetic demo. Normal test runs leave those assets unchanged. The browser executable override is optional and must point to a sufficiently recent Chromium-family browser that supports the test harness's CDP extension commands. It does not change the extension's declared Chrome 120 minimum.

The workspace sandbox blocked Vitest's temporary cache renames and the initial browser download. Those commands were rerun with the environment's approved escalation mechanism. The successful results above come from executed commands, rather than skipped tests.

## Manual release checks still to run

1. Load `dist/` through the visible `chrome://extensions` UI and repeat the README demo using the mouse and keyboard in your ordinary Chrome installation.
2. Try an ordinary site with a strict CSP and a page with iframes. Confirm the documented main-document collection scope.
3. Allow the service worker to suspend during a longer session. Reopen the popup, verify its report and status, then Stop.
4. Test screenshot retake/removal, event removal and delete-all on each supported operating system. Check keyboard and screen-reader access.

These broader release checks remain listed on the roadmap. The automated local acceptance workflow above has passed.
