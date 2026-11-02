# Engineering handoff — BugCapsule v0.3.0

## Delivered architecture

```text
Capture → Redaction → Evidence selection → Explicit transfer review
        → Gemini structured JSON → Schema and genuine-ID validation
        → Structured React diagnostic → Renewed privacy review → Export
```

The existing local-first extension remains intact. AI runs separately in the service worker, with developer-provided credentials and a fixed Google API origin. The default lightweight model remains selected until the user explicitly changes it. Model selection, prompt version and retry policy are bound to transmission consent. No backend or application-owned credential is introduced.

New report schema `1.2.0` supports structured analysis. Existing `1.0.0` and `1.1.0` reports, including string-based AI text, remain importable and exportable. Legacy provenance stays unknown. Imported provenance is not an authenticated provider receipt.

## Principal files changed

| Area | Files and purpose |
| --- | --- |
| Evidence and output contracts | `src/ai/payload.ts`, `schema.ts`, `prompt.ts` retain genuine event IDs/times, validate structured responses and define prompt `2.0.0` |
| Network service | `src/services/geminiTransport.ts`, `aiDiagnostic.ts`, `aiConfiguration.ts`, `aiError.ts` implement fixed-origin requests, model validation, bounded retry/backoff and safe failures |
| Worker lifecycle | `src/services/aiCoordinator.ts`, `src/background/controller.ts`, `index.ts` persist minimal pending state, reject stale results, coordinate cancellation/deletion and import reports |
| Reports | `src/shared/types.ts`, `src/core/schema.ts`, `report.ts`, `exports.ts`, `import.ts`, `public/report.schema.json` add structured metadata and backward compatibility |
| User interface | `src/ui/AISettings.tsx`, `AIDiagnosticPanel.tsx`, `StructuredDiagnosticView.tsx`, `ReportImporter.tsx`, `App.tsx`, `api.ts`, `styles.css` add controls, evidence expanders, copying and import |
| Evaluation | `eval/fixtures.ts`, `capture.ts`, `pipeline.ts`, `cli.ts`, `results.ts`, `validation.ts`, `review.ts`, `web.ts` reproduce defects, preserve A/B records and support human grading |
| Verification | Unit and browser tests, package scripts, TypeScript configuration and GitHub Actions include offline evaluation |
| Documentation | README, security/changelog, audit, architecture, threat model, AI guide, evaluation methodology, troubleshooting and verification record |

## Security findings and resolutions

The pre-edit audit found no literal Google key or secret-bearing Vite assignment in source or compiled assets. The reachable remote history consisted of one README commit and contained no matching credential pattern. No exposed key requiring rotation was identified. Pattern scans are a limited check, rather than proof that every possible secret is absent.

BYOK keys remain outside bundles, reports, pending-job metadata and content scripts. Session retention is the default, with optional trusted-context local retention. Browser storage is not an encrypted vault. Revoking an exposed key in Google AI Studio/Cloud is necessary even if its file is later removed from Git.

Free-form output was supplemented with strict structured validation. Unknown fields, invented event references, unsupported numeric confidence, mismatched report IDs and malformed responses are rejected. Observations and hypotheses are presented separately. Evidence links establish that a cited event was supplied, not that a causal explanation is correct.

Pending-job metadata survives popup closure and worker restart. An interrupted request is never automatically resent. Cancellation propagates through retries and queued result storage. Delete-all coordinates with prior key writes. Failed HTTP bodies are cancelled before a permitted retry, and a cancelled quota response cannot intentionally recreate cooldown state after deletion.

## Executed verification

The final test counts and exact environment are recorded in [verification](VERIFICATION.md). They include strict TypeScript, lint, unit tests, real-extension browser tests and offline benchmark execution. AI browser tests explicitly mock provider responses and native optional-permission approval. The original capture, screenshot/redaction, export, deletion/repeat and legacy import flows were exercised in a disposable Chrome profile.

The evaluation run reproduced 25 intentional defects and processed 50 A/B mock records with no provider calls. Mock results validate the protocol, payload and scoring machinery. They provide no model-accuracy finding, API latency, token usage or billable cost measurement. No human cause-identification scores or research success percentages were invented. The machine-readable execution summary is in `eval/examples/finalization-mock-summary.json`.

## Demonstration

1. Run `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm package`.
2. Load `dist/` unpacked in Chrome. Run `pnpm demo` and open `http://127.0.0.1:4173`.
3. Start capture from the toolbar, trigger Save draft or checkout, explicitly capture a screenshot, then Stop.
4. Edit the report and redact the screenshot. The local export path works without an AI key.
5. For a live AI demonstration, enter a personal Gemini key only in Settings. Review the selected model, retry policy and Google project billing/quotas.
6. In Preview, choose Run AI Diagnostic, inspect the exact evidence payload and approve its transmission. Approve Chrome's native permission prompt. Inspect hypotheses and expand actual event references.
7. Verify suggestions against source code. Review the final report for privacy and export Markdown, JSON or ZIP. Delete the local report and key when finished.

For reproducible experiments, follow [evaluation](EVALUATION.md). Live evaluation requires both `--adapter gemini` and `--allow-live`, plus a CLI-only environment key. Default evaluation is offline/mock and CI needs no secret.

## Remaining manual checks and limits

- No personal key was supplied, so a live Gemini request and account/model eligibility were not verified. No live quota or paid request was consumed.
- Native Google host-permission approval remains a visible-browser smoke check. Headless AI tests mock that boundary explicitly.
- Model quality requires an authorized live benchmark and independent human review. The 25 synthetic cases are a starting benchmark, not representative evidence of production performance.
- Provider usage metadata covers the final successful response. Failed retry-attempt usage may be unknown. Cost estimates require supplied prices and available token counts and are not billing receipts.
- Automated redaction can miss private prose and URL paths. Text already sent to Google cannot be recalled. Screenshots remain excluded from AI requests.
- Cross-platform manual smoke tests, screen-reader validation and independent security review remain release-hardening work.

## Repository status

The original GitHub remote and initial history are preserved. The owner approved source publication after this handoff was prepared. Publication uses the verified account's GitHub no-reply identity and a normal fast-forward push. A GitHub Release asset or Chrome Web Store submission is a separate distribution step. See [publishing](PUBLISHING.md).
