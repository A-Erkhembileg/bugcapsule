# AI diagnostic engine

BugCapsule's local capture-to-export workflow runs without a key or cloud account. AI is a separately approved operation that sends selected report text to Google Gemini.

## Pipeline

```text
Bug capture → Redaction → Evidence selection → Gemini
           → Schema and event-reference validation → Diagnostic UI → Export
```

The isolated capture bridge receives only bounded page diagnostics and optional safe interaction descriptions. Existing worker normalization sanitizes known secret patterns. `src/ai/payload.ts` validates the saved report, selects up to twelve distinct error groups and a reduced interaction timeline, reapplies sanitation, and preserves genuine IDs, timestamps and alias IDs for grouped events. The JSON preview is the text that will be sent as report evidence. Screenshots and older analysis are always excluded.

The model request also contains the versioned system prompt, the JSON response schema and generation settings. Authentication is supplied to Google separately in an API-key header. The key never appears in the evidence JSON, endpoint URL, report export or settings-status response.

## Output and provenance

The provider generates only bounded content fields. These include summary, observations, hypotheses, recommended debugging steps, missing evidence and limitations. Each observation refers to supplied events. Each hypothesis names supporting events, any contradicting events, a conditional fix, verification steps and uncertainty notes. Unsupported numerical confidence properties are rejected.

After parsing and runtime validation, the application assigns the analysis ID, report ID, provider, selected model, prompt version and generation timestamp. It checks every reference against the exact IDs supplied to the provider and checks the completed result again against the report. Invented event references and stale report results are discarded. A valid reference establishes identity, rather than proving that an event caused the failure.

Provider-reported token usage is included when available. It describes the final successful response, not the aggregate cost of failed retry attempts. Duration covers the operation. Missing usage remains missing, rather than being estimated from character counts.

Structured output is displayed as React text components with expandable explanations and actual event details. Generated content is never executed. Legacy string-based analyses remain readable and editable, with unavailable model, prompt and timestamp provenance explicitly left unknown.

Provenance is locally assigned for new requests. Imported metadata is user-supplied and is not a cryptographically authenticated receipt from Google. Evidence links establish that an event was supplied; they do not prove the model's causal explanation.

## Prompt versioning

`src/ai/prompt.ts` defines prompt version `2.0.0`. Changes to diagnostic instructions require a version bump. Evaluation records preserve model and prompt identifiers so experiments can be compared without silently changing the method. The prompt treats all webpage content as untrusted evidence, separates observation from inference, requires real evidence IDs, asks for falsifiable checks and prohibits claims that a fix was tested.

## Models and retry consent

Settings allow `gemini-3.5-flash-lite` or `gemini-3.8-flash`. The lightweight model remains the default. BugCapsule uses the selected model for the entire operation and never falls back automatically. Model access, quotas, prices and data terms depend on the user's Google project. Free-tier eligibility does not guarantee that a billing-enabled key will incur no charges.

Retries default off. Explicitly enabling retries allows at most two additional attempts for transient network/server failures or a short retryable rate limit. The transmission review states the approved maximum attempt count and model. The consent fingerprint includes the payload, model, prompt version and retry policy. A configuration or evidence change requires a new review.

Backoff starts from a bounded exponential delay with jitter and respects `Retry-After` within the 25-second overall deadline. Authentication and unavailable-model errors are not retried. Long quota waits are surfaced for later manual retry. Responses with invalid JSON, invalid schema or invented references are rejected rather than converted to plausible-looking text.

## Worker lifecycle

The worker owns the operation, rather than the popup. Pending metadata records report ID, model, start time and attempt count in trusted session storage before sending. Closing a view does not automatically resend or duplicate the request. When the worker restarts, saved running metadata becomes interrupted and the user must deliberately review and run again. No evidence or key is copied into the pending-job record.

Cancellation propagates through request, delay and result-commit checks. Report mutation and deletion remain usable because network waits are outside the capture mutation queue. Key changes are serialized, delete-all waits for earlier key writes, and evidence changes invalidate old analysis. These controls do not recall text already transmitted to Google.

## Transport choice

The existing browser-native REST `generateContent` path remains in use. It supports `responseMimeType: application/json` and the response JSON schema while fitting Manifest V3's static-code and CSP restrictions. Adding an SDK would duplicate a small fixed-origin request without improving this extension's credential boundary. The official SDK remains an option for a future backend integration. No provider code is loaded remotely. [Structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini API reference](https://ai.google.dev/api/generate-content).

## Evaluation and limitations

The reproducible A/B workflow, fixture ground truths, scoring rubric and human-review process are described in [evaluation](EVALUATION.md). Mock responses test integration and scoring mechanics without establishing model accuracy. A live result is still an unverified debugging suggestion. Known causes and acceptable answers belong to the evaluation oracle and must remain outside model input.

Automatic redaction cannot recognize every secret, business detail or sensitive URL path. Review the preview and edit the report before approval. Google's processing and free-tier data-use rules apply once text leaves the device. See [security](../SECURITY.md), the [threat model](THREAT_MODEL.md) and [troubleshooting](TROUBLESHOOTING.md).
