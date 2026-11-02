import { chromium } from '@playwright/test';
import { createReport, normalizeEvent } from '../src/core';
import { installInstrumentation } from '../src/page/instrumentation';
import type { CaptureEvent, Report } from '../src/shared/types';
import { defectFixtures, type DefectFixture } from './fixtures';
import { fixtureHTML } from './web';

export interface CapturedFixture {
  fixtureId: string;
  report: Report | null;
  actualState: string | null;
  reproductionPassed: boolean;
  failures: string[];
}

/** Execute the authored defects in a disposable browser; never fabricate evidence. */
export async function captureFixtures(
  fixtures: DefectFixture[] = defectFixtures,
): Promise<CapturedFixture[]> {
  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true,
    executablePath: process.env.BUGCAPSULE_BROWSER_EXECUTABLE,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
  });
  const results: CapturedFixture[] = [];
  try {
    for (const fixture of fixtures) {
      const page = await context.newPage();
      const events: CaptureEvent[] = [];
      const channel = `benchmark-${fixture.id}`;
      let startedAt = Date.now();
      try {
        await page.route('**/*', async (route) => {
          if (
            route.request().url() ===
            `http://bugcapsule-fixture.test/${fixture.id}`
          ) {
            await route.fulfill({
              contentType: 'text/html',
              body: fixtureHTML(fixture, false),
            });
          } else await route.abort();
        });
        await page.exposeFunction('__benchmarkRecord', (raw: unknown) => {
          if (events.length >= 200) return;
          const event = normalizeEvent(raw, startedAt);
          if (event)
            events.push({
              ...event,
              id: `${fixture.id}-E${String(events.length + 1).padStart(2, '0')}`,
            });
        });
        await page.goto(`http://bugcapsule-fixture.test/${fixture.id}`);
        startedAt = Date.now();
        await page.evaluate((session) => {
          const host = window as Window & {
            __benchmarkRecord?: (raw: unknown) => void;
          };
          window.addEventListener('message', (event) => {
            if (
              event.source === window &&
              event.origin === location.origin &&
              event.data?.source === 'bugcapsule' &&
              event.data.channel === session
            )
              host.__benchmarkRecord?.(event.data.event);
          });
          document.addEventListener(
            'click',
            () =>
              host.__benchmarkRecord?.({
                kind: 'click',
                message: 'Clicked button',
              }),
            true,
          );
        }, channel);
        // Controlled source snippets only. The helper preserves tsx/esbuild function names.
        await page.addScriptTag({
          content: `var __name=(fn)=>fn;(${installInstrumentation.toString()})(${JSON.stringify(channel)},${startedAt + 30_000});`,
        });
        await page.addScriptTag({
          content: `${fixture.script}\n//# sourceURL=http://bugcapsule-fixture.test/${fixture.id}.js`,
        });
        for (const selector of fixture.clicks ?? ['#run'])
          await page.locator(selector).click();
        // All fixture timers are <=45ms; allow asynchronous error dispatch to settle.
        await page.waitForTimeout(150);
        const actualState = await page.locator('#state').innerText();
        const environment = await page.evaluate(() => ({
          url: location.href,
          browser: navigator.userAgent,
          language: navigator.language,
          viewport: {
            width: innerWidth,
            height: innerHeight,
            devicePixelRatio,
          },
        }));
        const report = createReport(
          environment,
          startedAt,
          `benchmark-${fixture.id}`,
        );
        report.title = fixture.symptom;
        report.description =
          'Synthetic browser defect reproduced with the published benchmark trigger.';
        report.expectedBehavior = fixture.expectedBehavior;
        report.actualBehavior = `Observed fixture state: ${actualState}`;
        report.steps = fixture.reproductionSteps;
        report.events = events;
        const expected = fixture.expectedCapturedEvidence;
        const failures: string[] = [];
        if (
          expected.kind &&
          !events.some(
            (event) =>
              event.kind === expected.kind &&
              (!expected.messageIncludes ||
                event.message.includes(expected.messageIncludes)),
          )
        )
          failures.push(
            `Expected ${expected.kind} containing ${JSON.stringify(expected.messageIncludes)} was not captured.`,
          );
        if (expected.state !== undefined && expected.state !== actualState)
          failures.push(
            `Expected defective state ${JSON.stringify(expected.state)}, observed ${JSON.stringify(actualState)}.`,
          );
        results.push({
          fixtureId: fixture.id,
          report,
          actualState,
          reproductionPassed: failures.length === 0,
          failures,
        });
      } catch (error) {
        results.push({
          fixtureId: fixture.id,
          report: null,
          actualState: null,
          reproductionPassed: false,
          failures: [
            error instanceof Error ? error.message : 'Capture failed.',
          ],
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return results;
}
