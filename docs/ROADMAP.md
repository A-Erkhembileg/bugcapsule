# Roadmap

## Before a store release

- Complete the documented manual smoke test on stable Chrome across Windows, macOS, and Linux.
- Accessibility testing with screen readers and keyboard-only operation; independent security review.
- Test resource-heavy pages, aggressive CSP, and long sessions across service-worker suspension.
- Improve exact dropped-event visibility without additional permissions.
- Evaluate optimistic concurrency for multiple open report editors.
- Review privacy copy, package licenses, store disclosures, and screenshots against the release build.

## Later, with explicit consent

- Tab video recording with its own permissions, visible indicator, and storage limits.
- Approved GitHub issue creation and pluggable export integrations.
- Optional self-hosted/team sharing, independently deployable from capture.
- Deduplication based on sanitized signatures.
- Broader evaluation of optional AI diagnostics using labeled synthetic cases and human-reviewed expected hypotheses.

These are proposals. Optional Gemini diagnostics are implemented separately from these roadmap items. The local capture-to-export workflow remains usable without a provider account or API request.
