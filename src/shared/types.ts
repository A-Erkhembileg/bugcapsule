import type { AiDiagnosticResult } from '../ai/schema';

export type EventKind =
  'console-error' | 'error' | 'unhandled-rejection' | 'click' | 'navigation';

export interface CaptureEvent {
  id: string;
  kind: EventKind;
  timestamp: string;
  offsetMs: number;
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
}

export interface Environment {
  url: string;
  browser: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
  language: string;
}

export interface Report {
  schemaVersion: '1.0.0' | '1.1.0' | '1.2.0';
  id: string;
  createdAt: string;
  title: string;
  description: string;
  expectedBehavior: string;
  actualBehavior: string;
  steps: string[];
  environment: Environment;
  events: CaptureEvent[];
  screenshot?: {
    dataUrl: string;
    width: number;
    height: number;
    redacted: boolean;
  };
  privacyReviewed: boolean;
  aiDiagnostic?: string | AiDiagnosticResult;
}

export interface CaptureState {
  report: Report | null;
  active: boolean;
  tabId: number | null;
  startedAt: number | null;
  timelineEnabled: boolean;
  notice: string | null;
  droppedEvents: number;
}
