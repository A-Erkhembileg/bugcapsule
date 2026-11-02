# Changelog

## 0.3.0 — Unreleased

- Structured evidence-grounded diagnostics with runtime response and event-reference validation.
- Report schema `1.2.0` adds structured AI provenance while retaining legacy reports and free-form analysis.
- Dedicated bounded payload selection and versioned prompt `2.0.0`, preserving real event identifiers and timestamps.
- Explicit lightweight/Flash model configuration and optional bounded retry policy with backoff and jitter.
- Persisted pending-job metadata and safe interruption after service-worker restart, without automatic resend.
- JSON report import, renewed privacy review, and guarded internal PNG import.
- Expandable diagnostic hypotheses, evidence details, missing evidence, limitations and copyable debugging steps.
- Reproducible defect fixtures and A/B evaluation workflow with machine-readable outcomes and human grading.
- Expanded regression tests and documentation. Executed results and live-provider limitations are recorded separately in `docs/VERIFICATION.md`.

## 0.2.0 — Unreleased

- Optional Gemini diagnostic with an explicit sanitized text preview and per-request transmission consent.
- User-provided API key with session retention by default and optional device-local retention. No bundled API key.
- Google-origin permission requested only when the user sends a diagnostic.
- Bounded high-signal evidence, untrusted-input system instructions, cancel/loading states and quota error handling.
- Editable AI-generated hypotheses with renewed privacy review before export.
- Report schema `1.1.0` adds optional `aiDiagnostic` while ordinary `1.0.0` reports remain supported.
- AI text is sanitized and included in JSON, safely fenced Markdown and ZIP exports.

## 0.1.0 — Unreleased

- Explicit one-document capture of new console errors, JavaScript errors, and unhandled promise rejections.
- Optional tag-only click and limited same-document navigation timeline.
- MV3 extension with session-local storage and minimal permissions.
- Explicit viewport screenshots, preview, retake, removal, and opaque pixel redaction.
- Editable report fields, environment, and diagnostics, with privacy review before export.
- Versioned JSON, Markdown, and deterministic ZIP export.
- Dark and light themes, a full-page editor, and a local intentionally buggy demo.
- Core/lifecycle unit tests and a real-extension Playwright suite.

This is a repository implementation, not a Chrome Web Store release. See [verification](docs/VERIFICATION.md) for executed checks and environmental limitations.
