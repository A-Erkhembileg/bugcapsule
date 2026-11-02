import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { AI_PROMPT_VERSION } from '../src/ai/prompt';
import { aiModelSchema, type AiModel } from '../src/ai/schema';
import { evidenceIdsFromPayload } from '../src/ai/payload';
import { sanitizeText } from '../src/core/privacy';
import { defectFixtures } from './fixtures';
import { captureFixtures } from './capture';
import {
  estimateCost,
  evaluationPayload,
  mockDiagnostic,
  referenceMetrics,
} from './pipeline';
import { makeReview, gradeReview } from './review';
import type { EvaluationRecord, EvaluationRun } from './results';
import { fixtureHTML, fixtureIndex } from './web';
import { parseCaptures, parseEvaluationRun } from './validation';

function argumentsFor(command: string, raw: string[]) {
  const allowed: Record<string, string[]> = {
    run: [
      'adapter',
      'model',
      'out',
      'captures',
      'fixture',
      'allow-live',
      'input-price',
      'output-price',
    ],
    capture: ['out', 'fixture'],
    review: ['results', 'out'],
    grade: ['results', 'review', 'mapping', 'out'],
    serve: [],
  };
  if (!(command in allowed))
    throw new Error(
      'Use run, capture, review, grade, or serve. See docs/EVALUATION.md.',
    );
  const options = new Map<string, string>();
  for (let i = 0; i < raw.length; i++) {
    const argument = raw[i]!;
    if (!argument.startsWith('--'))
      throw new Error(`Unexpected argument ${argument}`);
    const name = argument.slice(2);
    if (!allowed[command]!.includes(name) || options.has(name))
      throw new Error(`Unknown or duplicate --${name}`);
    if (name === 'allow-live') options.set(name, 'true');
    else {
      const value = raw[++i];
      if (!value || value.startsWith('--'))
        throw new Error(`--${name} requires a value.`);
      options.set(name, value);
    }
  }
  return options;
}

async function jsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}
async function save(path: string, data: unknown, exclusive = false) {
  await mkdir(resolve(path, '..'), { recursive: true });
  if (path.endsWith('/checkpoint.json')) {
    // A killed process leaves the previous complete checkpoint readable.
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', {
      flag: 'wx',
    });
    await rename(temporary, path);
    return;
  }
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', {
    flag: exclusive ? 'wx' : 'w',
  });
}
async function requireNewFile(path: string) {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error(
    'Output already exists. Choose a new path to preserve earlier results and failures.',
  );
}
async function reserveDirectory(path: string) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  try {
    await mkdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        'Output directory already exists. Choose a new path to preserve earlier results and reviews.',
        { cause: error },
      );
    throw error;
  }
}
function required(options: Map<string, string>, name: string) {
  const value = options.get(name);
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function selectedFixtures(options: Map<string, string>) {
  const id = options.get('fixture');
  const selected = id
    ? defectFixtures.filter((item) => item.id === id)
    : defectFixtures;
  if (!selected.length)
    throw new Error('Unknown fixture. Use an ID such as BC-001.');
  return selected;
}

async function runEvaluation(options: Map<string, string>) {
  const adapter = options.get('adapter') ?? 'mock';
  if (adapter !== 'mock' && adapter !== 'gemini')
    throw new Error('--adapter must be mock or gemini.');
  const model = aiModelSchema.parse(
    options.get('model') ?? 'gemini-3.5-flash-lite',
  );
  if (adapter === 'gemini' && options.get('allow-live') !== 'true')
    throw new Error(
      'Live API requests are disabled. Review the methodology and payloads, then explicitly add --adapter gemini --allow-live.',
    );
  if (adapter === 'mock' && options.has('allow-live'))
    throw new Error('--allow-live is only meaningful with --adapter gemini.');
  // Read a real credential only after both explicit live switches have been checked.
  const key =
    adapter === 'gemini' ? process.env.GEMINI_API_KEY?.trim() : undefined;
  if (adapter === 'gemini' && !key)
    throw new Error(
      'Set GEMINI_API_KEY in the CLI environment. Never use a VITE_ secret or commit it.',
    );
  const input = options.get('input-price');
  const output = options.get('output-price');
  if (Boolean(input) !== Boolean(output))
    throw new Error(
      'Supply both --input-price and --output-price in dollars per million tokens, or omit both.',
    );
  const prices =
    input && output
      ? { inputPerMillion: Number(input), outputPerMillion: Number(output) }
      : null;
  if (
    prices &&
    !Object.values(prices).every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    throw new Error('Prices must be nonnegative numbers.');
  const selected = selectedFixtures(options);
  const captures = options.get('captures')
    ? parseCaptures(await jsonFile(options.get('captures')!)).filter((item) =>
        selected.some((fixture) => fixture.id === item.fixtureId),
      )
    : await captureFixtures(selected);
  if (captures.length !== selected.length)
    throw new Error('The capture file must include every selected fixture.');
  const runId =
    new Date().toISOString().replace(/[:.]/g, '-') +
    '-' +
    randomUUID().slice(0, 8);
  const out = options.get('out') ?? `eval/outputs/${runId}`;
  await reserveDirectory(out);
  const records: EvaluationRecord[] = [];
  console.log(
    `Running ${captures.length * 2} ${adapter === 'mock' ? 'synthetic mock comparisons; no provider calls' : 'explicitly authorized Gemini attempts; quota and billing apply'} on ${model}.`,
  );
  for (const [index, capture] of captures.entries()) {
    // Counterbalance temporal order. Both methods share this exact captured report.
    for (const method of index % 2
      ? (['B', 'A'] as const)
      : (['A', 'B'] as const)) {
      const record: EvaluationRecord = {
        recordId: `${capture.fixtureId}-${method}`,
        fixtureId: capture.fixtureId,
        method,
        adapter,
        providerWasCalled: false,
        payload: null,
        diagnostic: null,
        error: null,
        rawResponses: [],
        metrics: {
          wallTimeMs: 0,
          apiLatencyMs: null,
          inputCharacters: 0,
          inputTokens: null,
          outputTokens: null,
          estimatedCostUSD: null,
          references: 0,
          genuineReferences: 0,
          genuineReferenceFraction: null,
        },
      };
      const started = performance.now();
      try {
        if (!capture.reproductionPassed || !capture.report)
          throw new Error(
            'Fixture reproduction failed. No diagnostic request was made. ' +
              capture.failures.join(' '),
          );
        const payload = evaluationPayload(capture.report, method);
        record.payload = payload;
        record.metrics.inputCharacters = payload.length;
        if (adapter === 'mock')
          record.diagnostic = mockDiagnostic(payload, model);
        else {
          const { runGeminiDiagnostic } =
            await import('../src/services/aiDiagnostic');
          const fetcher: typeof fetch = async (request, init) => {
            record.providerWasCalled = true;
            const response = await fetch(request, init);
            const reader = response.clone().body?.getReader();
            const decoder = new TextDecoder();
            let text = '';
            let total = 0;
            let truncated = false;
            if (reader) {
              try {
                while (true) {
                  const next = await reader.read();
                  if (next.done) break;
                  total += next.value.byteLength;
                  if (total > 96_000) {
                    truncated = true;
                    break;
                  }
                  text += decoder.decode(next.value, { stream: true });
                }
                text += decoder.decode();
              } finally {
                await reader.cancel().catch(() => undefined);
                reader.releaseLock();
              }
            }
            const safe = sanitizeText(
              text.split(key!).join('[REDACTED API key]'),
              32_000,
            );
            record.rawResponses.push({
              status: response.status,
              body: safe,
              truncated: truncated || text.length > 32_000,
            });
            return response;
          };
          record.diagnostic = await runGeminiDiagnostic(payload, key!, {
            model: model as AiModel,
            maxRetries: 0,
            fetcher,
          });
          record.metrics.apiLatencyMs = record.diagnostic.durationMs ?? null;
          record.metrics.inputTokens =
            record.diagnostic.tokenUsage?.inputTokens ?? null;
          record.metrics.outputTokens =
            record.diagnostic.tokenUsage?.outputTokens ?? null;
          record.metrics.estimatedCostUSD = estimateCost(
            record.diagnostic.tokenUsage,
            prices ?? undefined,
          );
        }
        Object.assign(
          record.metrics,
          referenceMetrics(record.diagnostic, evidenceIdsFromPayload(payload)),
        );
      } catch (error) {
        record.error = sanitizeText(
          (error instanceof Error ? error.message : 'Unknown evaluation error.')
            .split(key ?? '\u0000')
            .join('[REDACTED API key]'),
          2_000,
        );
      }
      record.metrics.wallTimeMs =
        Math.round((performance.now() - started) * 100) / 100;
      records.push(record);
    }
    // Preserve completed records even if the process is interrupted later.
    await save(`${out}/checkpoint.json`, {
      schemaVersion: '1.0.0',
      benchmarkVersion: '1.0.0',
      promptVersion: AI_PROMPT_VERSION,
      runId,
      createdAt: new Date().toISOString(),
      adapter,
      model,
      partial: true,
      captures,
      records,
    });
  }
  const run: EvaluationRun = {
    schemaVersion: '1.0.0',
    benchmarkVersion: '1.0.0',
    runId,
    createdAt: new Date().toISOString(),
    adapter,
    model,
    promptVersion: AI_PROMPT_VERSION,
    conditions: [
      'Same actual captured report for A and B; same model, system prompt and output schema; no automatic retries.',
      'A supplies individual sanitized errors; B uses production evidence selection, report context and grouped timeline.',
      'No known cause, oracle explanation, fixture category or source snippet is transmitted to the model.',
      adapter === 'mock'
        ? 'MOCK ONLY. No model accuracy, API latency, token usage or API cost can be inferred.'
        : 'Live synthetic-data evaluation. Human review is still required for causal correctness and actionability.',
      'Cost is an estimate only when user-supplied rates and provider token counts are available. It is not a billing receipt.',
    ],
    pricing: prices,
    captures,
    records,
    summary: {
      fixtures: captures.length,
      reproduced: captures.filter((item) => item.reproductionPassed).length,
      reproductionFailures: captures.filter((item) => !item.reproductionPassed)
        .length,
      protocolValidResults: records.filter((item) => item.diagnostic !== null)
        .length,
      failedResults: records.filter((item) => item.error !== null).length,
      humanQualityScoresAvailable: false,
    },
  };
  await save(`${out}/results.json`, run);
  await save(`${out}/captures.json`, { schemaVersion: '1.0.0', captures });
  console.log(
    JSON.stringify({ output: `${out}/results.json`, ...run.summary }),
  );
  if (run.summary.reproductionFailures || run.summary.failedResults)
    process.exitCode = 1;
}

async function main() {
  const command = process.argv[2] ?? 'run';
  const options = argumentsFor(command, process.argv.slice(3));
  if (command === 'serve') {
    createServer((request, response) => {
      const id = request.url?.split(/[?#]/, 1)[0]?.slice(1) ?? '';
      const fixture = defectFixtures.find((item) => item.id === id);
      if (id && !fixture) {
        response.writeHead(404).end('Unknown fixture');
        return;
      }
      response
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        })
        .end(fixture ? fixtureHTML(fixture) : fixtureIndex(defectFixtures));
    }).listen(4174, '127.0.0.1', () =>
      console.log('Synthetic defect pages: http://127.0.0.1:4174'),
    );
  } else if (command === 'capture') {
    const out = options.get('out') ?? 'eval/outputs/captures.json';
    await requireNewFile(out);
    const captures = await captureFixtures(selectedFixtures(options));
    await save(out, { schemaVersion: '1.0.0', captures }, true);
    console.log(
      JSON.stringify({
        output: out,
        fixtures: captures.length,
        reproduced: captures.filter((item) => item.reproductionPassed).length,
      }),
    );
    if (captures.some((item) => !item.reproductionPassed)) process.exitCode = 1;
  } else if (command === 'run') await runEvaluation(options);
  else {
    const run = parseEvaluationRun(
      await jsonFile(required(options, 'results')),
    );
    if (command === 'review') {
      const out = options.get('out') ?? `eval/outputs/${run.runId}/review`;
      await reserveDirectory(out);
      const review = makeReview(run);
      await save(`${out}/packet.json`, review.packet);
      await save(`${out}/scores.json`, review.template);
      await save(`${out}/mapping-private.json`, review.mapping);
      console.log(
        `Review packet and empty score template saved in ${out}. Withhold mapping-private.json from blinded reviewers.`,
      );
    } else {
      const summary = gradeReview(
        run,
        await jsonFile(required(options, 'review')),
        await jsonFile(required(options, 'mapping')),
      );
      const out =
        options.get('out') ?? `eval/outputs/${run.runId}/human-summary.json`;
      await save(out, summary, true);
      console.log(`Human-reviewed summary saved in ${out}.`);
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Evaluation failed.');
  process.exitCode = 1;
});
