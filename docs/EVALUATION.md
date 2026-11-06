# Reproducible diagnostic evaluation

ReproQuill includes 25 intentionally defective browser fixtures and an A/B evaluation harness. The benchmark separates mechanical protocol correctness from diagnostic quality. Successful mock runs establish reproducibility, payload selection and schema/reference handling. They provide no evidence that Gemini identified a cause or suggested a useful fix.

## Dataset and capture

The source of truth is [`eval/fixtures.ts`](../eval/fixtures.ts). Each fixture defines a numeric identifier, reproducible trigger code, reproduction steps, known cause, expected browser error or incorrect UI state, an acceptable diagnostic explanation and relevant verification steps. The [fixture catalogue](../eval/FIXTURES.md) gives a readable reference.

The cases cover undefined/null values, malformed data, missing DOM elements, unhandled promises, async races, missing awaits, stale closures, state mutation, duplicate handlers, event targets, binding, network failures and additional browser defects. Network scenarios use deterministic synthetic failures rather than real external requests.

```sh
pnpm eval:fixtures
# Open http://127.0.0.1:4174 and choose a fixture.
```

For automated capture, Playwright creates a disposable Chromium profile and intercepts a synthetic fixture URL. Every other network request is blocked. It installs the production `installInstrumentation` function, triggers each published defect, and checks its actual error/rejection or defective UI state. It collects actual diagnostic messages and safe click markers. It does not insert the expected error as fabricated evidence. The expected-state assertions and known causes remain outside the model payload.

```sh
pnpm exec playwright install chromium
pnpm eval:capture --out eval/outputs/my-captures.json
```

On the verified Windows environment the downloaded Chrome for Testing had a loader error. The installed Chrome worked with this override.

```powershell
$env:BUGCAPSULE_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm eval:capture --out eval/outputs/my-captures.json
```

Capture failures retain their exception or failed assertion, report when available, and observed state. They are included in later results and block an overall successful run. Cached capture files are schema-validated and must contain distinct, known fixtures. Recapture after changing fixture code; capture files are not signed evidence of their origin.

## Comparison design

| Condition | Supplied model evidence |
| --- | --- |
| A, minimally structured baseline | Individual sanitized error records, including genuine identifiers and timestamps. Report prose and interaction timeline are omitted |
| B, ReproQuill pipeline | Production redaction and evidence selection, grouped repeated errors with genuine ID aliases, a bounded generic timeline, reproduction steps and user-visible report context |

Both conditions use the same captured report, selected model, prompt version and structured response schema. Retrying is disabled for the evaluation. Request order is counterbalanced A/B then B/A across fixtures. This compares the combined filtering/context treatment rather than isolating every individual design choice. A factorial ablation study would be needed to attribute improvements to deduplication, context or timeline separately.

Known causes, acceptable explanations, fixture categories and source snippets are never supplied to either model condition. Numeric case IDs avoid naming the answer. The dataset is small, synthetic and authored by the project, so it cannot establish performance on unrelated production bugs.

## Offline protocol rehearsal

```sh
pnpm eval:run --captures eval/outputs/my-captures.json --out eval/outputs/my-mock-run
```

The default adapter is `mock`. It emits a conservative fixed response, states that no Google request or causal analysis occurred, and returns no hypotheses. It does not copy the known cause into an invented model answer. This allows normal CI and local checks to run without credentials or quota use.

The harness produces `results.json`, `captures.json` and a progressively updated `checkpoint.json`. Checkpoints identify themselves as partial and include the schema, benchmark and prompt versions. A temporary file and rename replace each checkpoint so an interrupted write leaves the previous complete checkpoint readable. Completed records and failures from prior checkpoints remain available if a run stops early. Capture files and run/review output paths refuse to overwrite an existing file or directory. Choose a new name for another run.

## Opt-in live evaluation

Live calls require both `--adapter gemini` and `--allow-live`, plus a personal `GEMINI_API_KEY` in the Node CLI's environment. The CLI reads the key only after the live authorization flags pass. No `VITE_*` secret is used. Never commit the key, paste it into a report, or print it in a command transcript.

```sh
# Configure your own GEMINI_API_KEY privately in this terminal first.
pnpm eval:run --adapter gemini --allow-live --model gemini-3.5-flash-lite --captures eval/outputs/my-captures.json --out eval/outputs/my-live-run
```

This makes up to 50 provider requests for the full 25-case A/B benchmark. Eligibility, quotas, data-use terms and billing depend on the Google project. Inspect the synthetic data and current provider terms before authorizing it. Select `gemini-3.8-flash` explicitly if desired. There is no silent model fallback. No live request was executed during this engineering finalization.

Use `--fixture BC-001` to limit a capture or evaluation to one selected fixture. Fresh runs use the selected fixture set; a cached file can contain the full dataset, from which the selected case is taken.

## Metrics and failure handling

Every record stores its condition, adapter, payload, validated diagnosis or error, model/prompt provenance and timing. For live calls, bounded sanitized provider responses and HTTP status are retained for counterexample review. Headers and credentials are excluded. Truncated raw bodies are marked. A rejected result is not replaced with a successful-looking mock.

| Measure | Calculation and limitation |
| --- | --- |
| Known cause identified | Independent human rubric score. Fraction fully identified uses all reviewed cases, including failures |
| Genuine evidence references | IDs cited in observations and hypotheses compared with the exact outbound IDs. No references gives `null`, rather than a false perfect score |
| Actionable debugging steps | Independent human rubric score tied to the published defect and source |
| Unsupported claims | Human count/severity, including invented facts or unjustified certainty |
| API latency | Measured provider operation duration for live results. Mock API latency is `null`. Missing latency is not counted as zero |
| Token usage | Provider metadata when available. Mock and missing counts are `null` |
| Approximate cost | Computed only from actual returned input/output token counts and explicitly supplied dollar-per-million prices |

To request a cost estimate, supply both `--input-price NUMBER` and `--output-price NUMBER`. Verify current prices yourself. The estimate is not a billing receipt and may omit discounts or provider accounting details. The transport can report only usage returned by the final provider response; evaluation disables retries, and no aggregate cost for failed earlier attempts is claimed.

Runtime validation rejects malformed structured output and invented event references. Therefore genuine-reference coverage among accepted results is a selection-biased protocol metric. Rejected responses, errors and incomplete cases must also be reported; accepted-only coverage is not model accuracy. Raw rejected responses support manual counterexample review.

## Independent human review

```sh
pnpm eval:review --results eval/outputs/my-live-run/results.json --out eval/outputs/my-live-run/review
```

This creates a randomized `packet.json`, an empty `scores.json`, and `mapping-private.json`. Withhold the mapping and the original condition-labeled results from reviewers. The packet provides the known cause, acceptable explanation, full captured evidence, model response or failure, and relevant source-checking guidance. Method identities are omitted, though response content and metadata can still reveal clues about a condition. This is label blinding rather than guaranteed full blinding.

Use two human reviewers where practical. Each reviewer should work independently before discussing disagreements. Record a reviewer identifier, UTC review timestamp and explanation for each score. Keep both original rating files and a separate adjudicated file when reconciling disagreements. The same model that generated the result must not conclusively grade itself. Automated schema checks supplement rather than replace this human process.

| Score | Cause identification | Debugging actionability | Unsupported claims |
| --- | --- | --- | --- |
| 0 | Misses the known cause, contradicts it, or returns no usable result | No concrete relevant check or unusable result | No unsupported substantive claim observed |
| 1 | Identifies a compatible general mechanism but misses a material part | At least one relevant check, but vague or missing an expected outcome | A minor unsupported assumption or unjustified detail |
| 2 | Identifies the known mechanism with appropriate uncertainty and evidence | Specific, relevant steps that can confirm/falsify the mechanism | Material fabrication, unjustified causal certainty or harmful recommendation |

For unsupported claims, higher is worse. A failed provider result must receive zero cause-identification and actionability credit. It remains in the denominator and has an explicit failure count. Do not silently discard hard or failed cases.

The score file contains only the fields already present in its template. Fill every `null`, reviewer and notes field without adding packet/oracle fields. Then aggregate deterministically.

```sh
pnpm eval:grade --results eval/outputs/my-live-run/results.json --review eval/outputs/my-live-run/review/scores.json --mapping eval/outputs/my-live-run/review/mapping-private.json --out eval/outputs/my-live-run/human-summary.json
```

The grader requires complete, unique review-to-record mapping and ratings for both methods. It refuses mock model-quality grading, incomplete ratings, duplicate mappings and credit for failed results. Aggregation cannot validate a reviewer's honesty or expertise; preserve review notes and source evidence for scrutiny.

## Executed engineering results

The checked-in [protocol summary](../eval/examples/finalization-mock-summary.json) records an actual run of this harness. All 25 executable browser defects reproduced, and 50 A/B mock outputs passed protocol validation with no provider calls. No human quality ratings, model-accuracy percentage, API latency, token usage or request cost were obtained. The earlier output-preservation test deliberately refused to overwrite an existing capture, and the grader deliberately rejected a mock quality-grading request. These were expected safeguards, not model failures.

The full synthetic run artifacts are retained locally under `eval/outputs/` and excluded from source control. The fixture source, methodology, small summary and tests are version-controlled. Later live experiments should preserve every failure/counterexample, report model and prompt versions, retain reviewer disagreement, and describe the dataset's limitations before claiming a research finding.

Accepted-result reference fractions are measured after strict evidence validation, so they are 1 by construction when references exist. They are protocol checks, not an independent estimate of model hallucination. Rejected responses and their bounded raw response text remain recorded for inspection. The A/B comparison tests the complete evidence/context selection treatment; it does not isolate deduplication from the additional reproduction context supplied by method B.
