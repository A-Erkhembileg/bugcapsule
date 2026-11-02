# Security policy

BugCapsule is an early local-first extension with an optional hosted AI diagnostic. No independent security audit has been performed.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** option on the repository Security page if private vulnerability reporting is enabled. Otherwise request a private contact channel from the maintainer through [their GitHub profile](https://github.com/A-Erkhembileg), without publishing exploit details or sensitive captures.

Include the affected version, Chrome version, a minimal synthetic reproduction, expected versus observed behavior, and the potential privacy impact. Never attach real tokens, cookies, passwords, personal screenshots, or private report exports. No response-time or bounty guarantee is offered.

## Security boundaries

- Collection is initiated from a trusted extension page, scoped to one tab's main document, and capped in duration and size.
- Page diagnostics and the DOM bridge are untrusted. A hostile page can forge or suppress errors. Reports are debugging aids, not forensic evidence.
- Automated redaction is heuristic. Sensitive free text, URL paths, and image pixels can remain. Manual review is required.
- Capture, editing and export work locally. The optional AI diagnostic transmits a reviewed, sanitized text payload to Google's Gemini API only after explicit request consent. It excludes screenshot bytes, the stored API key and previous analysis from that payload. The key is supplied separately in an authentication header to Google.
- There is no telemetry, cookie access, request-body collection or remotely executed code. Optional network access is restricted to the Google API origin.
- API keys default to session storage. Users may explicitly remember a key in local device storage. Both storage areas are restricted to trusted extension contexts. This is not encrypted key storage. A key compiled into a `VITE_` environment variable would be extractable from the bundle, so this project does not use that mechanism.
- AI responses are validated against a bounded JSON schema. Observations and hypotheses must reference event IDs supplied in the exact approved payload. Invented references, mismatched report identity and malformed responses are rejected. Structured React components render text without executing generated HTML or code. This validates structure and reference membership, while the truth of the proposed explanation still requires source inspection and testing.
- Model selection and retry policy are explicit. Automatic retries default off. Enabling retries permits up to two additional attempts within the overall deadline and may consume quota or incur charges. Authentication failures do not trigger retries or a model fallback.
- Pending request metadata is stored locally. Worker restarts safely mark incomplete jobs interrupted without resending. Cancellation cannot recall evidence already delivered to Google.
- JSON import revalidates schema, report identity and diagnostic references and clears export review. Portable screenshot references are dropped. Internal PNG bytes must match declared dimensions and satisfy the import pixel budget before rendering.
- Session storage is ephemeral, but is not encrypted storage or a secure-erasure mechanism. Browser/OS administrators, malware, debugging tools, and exported files lie outside this threat boundary.

See the [threat model](docs/THREAT_MODEL.md) for controls, residual risks, and test coverage.

## Credentials and rotation

BugCapsule uses a developer-focused bring-your-own-key workflow. It has no application-owned Gemini credential or authenticated backend proxy. Trusted-context browser storage narrows access to packaged extension code but cannot provide backend-equivalent secret protection. A future shared application-owned key must be held by an authenticated, rate-limited server rather than compiled into extension JavaScript.

If a key is exposed in a report, screenshot, repository, log or public message, revoke it in Google AI Studio or the Google Cloud console, inspect usage and billing, and create a restricted replacement. Remove it from BugCapsule and any published material. Deleting a Git commit or a downloaded report cannot revoke a credential already copied by someone else. Never include the key in a vulnerability report.
