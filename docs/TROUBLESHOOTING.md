# Troubleshooting

## Local capture

Use the BugCapsule toolbar popup on an ordinary HTTP or HTTPS page. Start collection explicitly, then reproduce the defect. Errors from before Start, other frames and other tabs are outside the capture scope. Browser settings pages, extension pages and the Chrome Web Store restrict injection. After navigation or reload, begin a new capture from the destination document.

If a screenshot fails, return to the original active document and use its toolbar popup. Tab switches or navigation during capture cause the worker to discard the pixels. Reduce the window size if the encoded screenshot exceeds the storage bound.

## AI configuration

When no key is configured, local capture and exports remain available. Enter a personal key only in Settings. A session-only key disappears when the browser session ends or the extension reloads. Choose device persistence only if its unencrypted storage is acceptable. Never put a key in a `VITE_` variable, report field or source file.

For HTTP 401/403, check key restrictions, Google project eligibility and API access in Google AI Studio. Replacing the key cancels a current operation. An HTTP 404 can mean the chosen model is unavailable to the project. Select a supported model explicitly. BugCapsule does not silently switch accounts or models.

## Consent and permissions

Stop capture and save the report before preparing analysis. Open the exact payload preview and check the Google disclosure. Grant the optional Google-origin permission only after deciding that the text is suitable to send. Denial leaves the report local.

If evidence, model or retry configuration changes after preview, the fingerprint check rejects the old consent. Review the new payload before sending again. Canceling while Chrome's permission dialog is pending invalidates that attempt locally.

Native optional-host approval can remain pending in headless automation. The automated AI UI tests use an explicitly documented test permission boundary. For a live smoke test, use visible Chrome and approve its native dialog yourself.

## Rate limits, network failures and interruption

A 429 response indicates quota or rate limiting. Check the project's usage and wait for the displayed interval. Retries default off. If enabled and approved, only short retryable delays fit the bounded attempt count and overall deadline. Repeated clicks cannot bypass the stored cooldown.

A timeout or connection failure leaves the captured report available. If the worker is restarted, the previous operation is marked interrupted and is not automatically sent again. Inspect the report and deliberately rerun when ready. Cancellation stops local request processing where possible, while data already delivered to Google cannot be recalled.

## Invalid analysis or missing evidence

Malformed JSON, unexpected fields, invented event references, incomplete generation and oversized responses are rejected. No fake diagnosis replaces them. If there are no relevant errors, the model may return no hypotheses and ask for missing context. A valid diagnostic can still be wrong. Check each hypothesis against source code and real tests.

## Imported reports

Import a JSON report within the UI's file-size bound. Unknown private configuration, unsupported versions, duplicate event IDs and mismatched structured evidence are rejected. Privacy review always resets. A portable JSON screenshot reference cannot restore pixels that were not included. Internal PNG bytes are accepted only when their actual header dimensions match the metadata and fit the 16-million-pixel import budget. ZIP import is outside this release.

## Development

Run the commands in [contributing](../CONTRIBUTING.md). The supported extension development loop is production build, then reload `dist/` in Chrome. Keep provider calls mocked in ordinary tests and CI. Run a live API smoke test only after explicitly authorizing quota use and selecting synthetic evidence. Current executed results and environment-specific browser workarounds are in [verification](VERIFICATION.md).
