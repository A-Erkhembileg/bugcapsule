# Reproducible defect pages

Run `pnpm eval:fixtures` to serve the 25 intentionally broken pages at `http://127.0.0.1:4174`.

Each page uses synthetic values and local code. The network cases simulate response objects or rejected promises without contacting an outside server. Open a page, start ReproQuill from the toolbar, and follow the displayed reproduction steps.

The authored trigger code and oracle documentation live in `eval/fixtures.ts`. The automated harness executes those same snippets in Chromium with the production page instrumentation. It asserts the expected captured event or observable wrong state, then saves the resulting report. Oracle fields are withheld from model input.

These small cases support controlled evaluation. They do not represent a production-web benchmark or prove general debugging ability. See `docs/EVALUATION.md` for the rubric and limitations.
