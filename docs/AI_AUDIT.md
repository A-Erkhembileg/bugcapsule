# AI finalization audit

The audit completed before finalization edits. The starting point was BugCapsule v0.2.0. The original extension and repository layout were retained.

## Verified baseline

`pnpm check` passed lint, strict TypeScript, 81 unit tests across five files and the production MV3 build. Four Playwright tests passed in a disposable Chrome profile. Two exercise actual capture and export; two mock Gemini and the native optional-host permission boundary. They establish application behavior, rather than model quality or live account access.

## Existing pipelines

- A toolbar action grants temporary active-tab access. Explicit Start installs main-world error observers and an isolated relay. The worker validates sender, tab, frame, document and channel before session-local storage.
- Privacy filters bound and redact primitive diagnostic text. Optional interaction tracking avoids input values. Screenshots require an explicit action and can be redacted into opaque pixels.
- The stopped report editor saves validated drafts. Changes invalidate privacy review. Markdown, versioned JSON and deterministic ZIP exports share the validated report.
- Optional BYOK Gemini calls run in the service worker after exact-payload preview, explicit consent and an optional Google-origin permission. The key uses trusted-context session storage by default with optional local retention. It is not encrypted secret storage.

## Gaps and modifications

| Finding | Finalization scope |
| --- | --- |
| AI text has no enforced evidence references or provenance schema | Add structured runtime validation, locally assigned metadata and rejection of invented event IDs |
| Compaction loses event identifiers and absolute timestamps | Extract dedicated payload selection retaining IDs, grouped aliases and meaningful times |
| Model and prompt are hardcoded, output is free-form | Add allowlisted model settings, versioned instructions and provider JSON Schema |
| Network failures have no bounded retry policy | Add explicit opt-in retries with bounded backoff/jitter, deadline and no authentication retries |
| In-flight status lives only in worker memory | Persist minimal pending metadata and safely mark interrupted jobs on restart without resending |
| Legacy reports have no import action | Add bounded JSON import and normalization for old string analysis and new structured results |
| Tests exercise mocked transport, with no diagnostic benchmark | Add executable defect fixtures, A/B evaluation, machine-readable failures and independent human review |

## Credential audit

Pattern scans of source, generated JavaScript, tests and configuration found no literal Google API key, private-key block or secret-bearing `VITE_*` assignment. The existing Gemini key is supplied by the user and sent only as an authentication header. No credential value was printed or exported during the audit.

At the start of the audit the local branch had no commits. The configured `origin` was preserved and fetched for inspection. Its one initial commit contains a README, MIT license and Node gitignore; the credential-pattern scan found no matches. Pattern scanning cannot prove the absence of every secret format. No exposed credential was identified requiring rotation. If an owner later discovers one, revoke it in Google AI Studio/Cloud, replace it and review project usage; removing a Git file alone does not revoke a key.

No application-owned credential or backend proxy is introduced. The developer-focused BYOK mode remains distinct from server-held credentials. Standard REST requests are retained to fit the existing MV3 architecture and avoid an unnecessary SDK dependency.

## Preservation requirements

Local capture/export needs no AI account or key. Collection remains explicit, document-scoped and bounded. No browsing permission is added for diagnostics. Screenshots remain excluded from AI requests. Existing key retention controls, data deletion, visual styling, privacy review and legacy report support must continue working. No live provider test or paid quota use is authorized by the audit.
