import type { AiDiagnosticResult, AiModel } from '../src/ai/schema';
import type { CapturedFixture } from './capture';
import type { EvaluationMethod } from './pipeline';

export interface EvaluationRecord {
  recordId: string;
  fixtureId: string;
  method: EvaluationMethod;
  adapter: 'mock' | 'gemini';
  providerWasCalled: boolean;
  payload: string | null;
  diagnostic: AiDiagnosticResult | null;
  error: string | null;
  rawResponses: { status: number; body: string; truncated: boolean }[];
  metrics: {
    wallTimeMs: number;
    apiLatencyMs: number | null;
    inputCharacters: number;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUSD: number | null;
    references: number;
    genuineReferences: number;
    genuineReferenceFraction: number | null;
  };
}

export interface EvaluationRun {
  schemaVersion: '1.0.0';
  benchmarkVersion: '1.0.0';
  runId: string;
  createdAt: string;
  adapter: 'mock' | 'gemini';
  model: AiModel;
  promptVersion: string;
  conditions: string[];
  pricing: { inputPerMillion: number; outputPerMillion: number } | null;
  captures: CapturedFixture[];
  records: EvaluationRecord[];
  summary: {
    fixtures: number;
    reproduced: number;
    reproductionFailures: number;
    protocolValidResults: number;
    failedResults: number;
    humanQualityScoresAvailable: false;
  };
}
