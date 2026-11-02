import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Worker,
} from '@playwright/test';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

// TEST-ONLY provider and permission boundaries are stubbed. Chrome's native
// optional-host dialog requires a separate manual smoke test. No real credential
// or report content leaves this disposable browser profile during these tests.
const TEST_KEY = 'test-key-not-a-real-credential';
const AI_SUMMARY =
  'Synthetic browser-test output. No live Google call was made.';
const AI_EXPLANATION = 'The save handler rejects the missing identifier.';
let context: BrowserContext;
let worker: Worker;
let editor: Page;
let browserCDP: CDPSession;
let extensionId: string;

test.beforeEach(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    executablePath: process.env.BUGCAPSULE_BROWSER_EXECUTABLE,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  browserCDP = await context.browser()!.newBrowserCDPSession();
  await browserCDP.send('Extensions.loadUnpacked', {
    path: path.resolve('dist'),
  });
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  await worker.evaluate(
    ({ summary, explanation }) => {
      type Mock = {
        calls: { url: string; body: string; headers: Record<string, string> }[];
        status: number;
        summary: string;
        explanation: string;
        remainingTransient: number;
      };
      const host = globalThis as typeof globalThis & { __geminiTest?: Mock };
      const mock: Mock = {
        calls: [],
        status: 200,
        summary,
        explanation,
        remainingTransient: 0,
      };
      host.__geminiTest = mock;
      chrome.permissions.contains = (async (
        permissions: chrome.permissions.Permissions,
      ) =>
        permissions.origins?.length === 1 &&
        permissions.origins[0] ===
          'https://generativelanguage.googleapis.com/*') as typeof chrome.permissions.contains;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (!url.startsWith('https://generativelanguage.googleapis.com/')) {
          throw new Error(
            'Unexpected external request in the mocked-provider test.',
          );
        }
        mock.calls.push({
          url,
          body: String(init?.body ?? ''),
          headers: Object.fromEntries(new Headers(init?.headers)),
        });
        if (mock.remainingTransient > 0) {
          mock.remainingTransient--;
          return new Response('{}', { status: 503 });
        }
        if (mock.status === 429)
          return new Response('{}', {
            status: 429,
            headers: { 'retry-after': '60' },
          });
        const envelope = JSON.parse(String(init?.body));
        const payload = JSON.parse(envelope.contents[0].parts[0].text);
        const eventId = payload.errors[0]?.id;
        if (!eventId)
          throw new Error('Expected a genuine captured error in this fixture.');
        const analysis = {
          summary: mock.summary,
          observations: [
            {
              description: 'A captured error interrupted the Save action.',
              eventIds: [eventId],
            },
          ],
          hypotheses: [
            {
              hypothesisId: 'H1',
              title: 'Missing document identifier',
              explanation: mock.explanation,
              supportingEventIds: [eventId],
              contradictingEventIds: [],
              suggestedFix:
                'Validate the document identifier in the Save handler.',
              verificationSteps: [
                'Inspect the Save draft handler and reproduce a missing identifier.',
              ],
              uncertaintyNotes:
                'Synthetic test response; no fix was executed or verified.',
            },
          ],
          recommendedDebuggingSteps: [
            'Inspect the Save draft handler and add a focused regression test.',
          ],
          missingEvidence: [
            'Application source code and a verified fix are unavailable.',
          ],
          limitations: [
            'Mock provider output exercises the UI only and establishes no model accuracy.',
          ],
        };
        return Response.json({
          candidates: [
            {
              content: { parts: [{ text: JSON.stringify(analysis) }] },
              finishReason: 'STOP',
            },
          ],
        });
      };
    },
    { summary: AI_SUMMARY, explanation: AI_EXPLANATION },
  );
  editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/index.html?view=full`);
  await expect(
    editor.getByText('Ready when you are', { exact: true }),
  ).toBeVisible();
  await permissionBoundary('grant');
});

test.afterEach(async () => {
  await context?.close();
});

async function toolbarClick(demo: Page, button: string) {
  const hasPopup = await editor.evaluate(
    () => chrome.extension.getViews({ type: 'popup' }).length > 0,
  );
  if (!hasPopup) {
    await demo.bringToFront();
    const { targetInfos } = await browserCDP.send('Target.getTargets', {
      filter: [{ type: 'tab' }],
    });
    const target = targetInfos.find((item) => item.url === demo.url());
    if (!target) throw new Error('The demonstration tab was unavailable.');
    await browserCDP.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: target.targetId,
    });
  }
  await expect
    .poll(() =>
      editor.evaluate((label) => {
        const view = chrome.extension.getViews({ type: 'popup' })[0];
        const control =
          view &&
          Array.from(view.document.querySelectorAll('button')).find(
            (item) => item.textContent?.trim() === label,
          );
        if (!control || control.disabled) return false;
        control.click();
        return true;
      }, button),
    )
    .toBe(true);
}

async function stoppedReport() {
  const demo = await context.newPage();
  await demo.goto('http://127.0.0.1:4173/?token=private-query-not-for-ai');
  await toolbarClick(demo, 'Start capture');
  await expect(
    editor.getByText('Capture is active', { exact: true }),
  ).toBeVisible();
  await demo.locator('#throw-error').click();
  await demo.locator('#console-error').click();
  await expect
    .poll(async () => {
      const result = await editor.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_STATE' }),
      );
      return result.state.report.events.length;
    })
    .toBeGreaterThanOrEqual(2);
  await toolbarClick(demo, 'Screenshot');
  await expect(editor.getByText('Attached', { exact: true })).toBeVisible();
  await toolbarClick(demo, 'Stop capture');
  await expect(
    editor.getByText('Capture stopped', { exact: true }),
  ).toBeVisible();
  await editor.bringToFront();
  await editor
    .getByLabel('Bug title', { exact: true })
    .fill('The synthetic save button gets stuck');
  await editor
    .getByTestId('reproduction-steps')
    .fill('Open the demo\nClick Save draft\nObserve the failure');
  await editor.getByRole('button', { name: 'Save changes' }).click();
}

async function providerCalls() {
  return worker.evaluate(() => {
    const host = globalThis as typeof globalThis & {
      __geminiTest?: {
        calls: { url: string; body: string; headers: Record<string, string> }[];
      };
    };
    return host.__geminiTest?.calls ?? [];
  });
}

async function download(editor: Page, name: string) {
  const receiving = editor.waitForEvent('download');
  await editor.getByRole('button', { name, exact: true }).click();
  const path = await (await receiving).path();
  if (!path) throw new Error('The report download was unavailable.');
  return readFile(path);
}

async function permissionBoundary(mode: 'grant' | 'deny' | 'pending') {
  await editor.evaluate((decision) => {
    const host = window as Window & {
      __permissionResolve?: (allowed: boolean) => void;
    };
    chrome.permissions.request = (async (
      permissions: chrome.permissions.Permissions,
    ) => {
      if (
        permissions.origins?.length !== 1 ||
        permissions.origins[0] !== 'https://generativelanguage.googleapis.com/*'
      ) {
        throw new Error('Unexpected permission request in the test boundary.');
      }
      if (decision === 'pending')
        return new Promise<boolean>((resolve) => {
          host.__permissionResolve = resolve;
        });
      return decision === 'grant';
    }) as typeof chrome.permissions.request;
  }, mode);
}

async function prepareConsent() {
  await editor
    .getByRole('button', { name: 'Run AI Diagnostic', exact: true })
    .click();
  await expect(
    editor.getByText('Review what Google will receive', { exact: true }),
  ).toBeVisible();
  await editor.getByLabel(consentLabel).check();
}

async function mockScreenshot(name: string) {
  if (process.env.BUGCAPSULE_DOC_SCREENSHOTS !== '1') return;
  // A test-only banner makes the synthetic provider boundary explicit in evidence.
  await editor.locator('.ai-diagnostic-panel').evaluate((panel) => {
    const banner = document.createElement('p');
    banner.id = 'mock-provider-evidence';
    banner.textContent =
      'MOCK PROVIDER TEST — synthetic response and permission boundary';
    banner.style.cssText =
      'padding:12px;border:1px solid #a09af9;color:#aaa5ff;font-weight:700;margin-bottom:16px';
    panel.prepend(banner);
    panel.scrollIntoView({ block: 'start' });
  });
  await mkdir('docs/images', { recursive: true });
  await editor.screenshot({ path: `docs/images/${name}-mock.png` });
  await editor
    .locator('#mock-provider-evidence')
    .evaluate((element) => element.remove());
}

async function configureKey(remember = false) {
  await editor
    .getByRole('button', { name: 'Settings & privacy', exact: true })
    .click();
  await editor.getByLabel('Gemini API key', { exact: true }).fill(TEST_KEY);
  await editor
    .getByLabel('Remember the key on this device', { exact: true })
    .setChecked(remember);
  await editor
    .getByRole('button', { name: 'Save API key', exact: true })
    .click();
  await expect(
    editor.getByLabel('Gemini API key', { exact: true }),
  ).toHaveValue('');
  await expect(
    editor.getByText(
      remember
        ? 'Key saved on this device.'
        : 'Key saved for this browser session.',
      { exact: true },
    ),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Bug report', exact: true }).click();
  await editor.getByRole('tab', { name: 'Preview', exact: true }).click();
}

const consentLabel =
  'I reviewed this text and allow BugCapsule to send it to Google Gemini for this diagnostic.';

test('mocked Gemini stays opt-in, excludes private attachments, and saves reviewable analysis in exports', async () => {
  await stoppedReport();
  await configureKey();
  expect(await providerCalls()).toEqual([]);
  const keyState = await editor.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    session: await chrome.storage.session.get(null),
  }));
  expect(JSON.stringify(keyState.local)).not.toContain(TEST_KEY);
  expect(JSON.stringify(keyState.session)).toContain(TEST_KEY);
  expect(JSON.stringify(keyState.session.capture)).not.toContain(TEST_KEY);
  await editor
    .getByRole('button', { name: 'Run AI Diagnostic', exact: true })
    .click();
  await expect(
    editor.getByText('Review what Google will receive', { exact: true }),
  ).toBeVisible();
  const send = editor.getByRole('button', {
    name: 'Send reviewed text to Gemini',
    exact: true,
  });
  await expect(send).toBeDisabled();
  expect(await providerCalls()).toEqual([]);
  await editor.locator('.ai-payload summary').click();
  const preview = await editor.locator('.ai-payload pre').innerText();
  expect(preview).not.toContain('data:image');
  expect(preview).not.toContain('private-query-not-for-ai');
  expect(preview).not.toContain('fake-demo-token');
  expect(preview).not.toContain(TEST_KEY);
  expect(JSON.parse(preview)).not.toHaveProperty('screenshot');
  await editor.getByLabel(consentLabel).check();
  await permissionBoundary('deny');
  await send.click();
  await expect(editor.getByRole('alert')).toContainText(
    'access was not granted',
  );
  expect(await providerCalls()).toEqual([]);
  await permissionBoundary('pending');
  await editor.getByLabel(consentLabel).check();
  await send.click();
  await editor
    .getByRole('button', { name: 'Cancel analysis', exact: true })
    .click();
  await editor.evaluate(async () => {
    const host = window as Window & {
      __permissionResolve?: (allowed: boolean) => void;
    };
    host.__permissionResolve?.(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await expect(
    editor.getByRole('button', { name: 'Run AI Diagnostic', exact: true }),
  ).toBeVisible();
  expect(await providerCalls()).toEqual([]);
  await permissionBoundary('grant');
  await prepareConsent();
  await mockScreenshot('ai-consent');
  await send.click();
  await expect(editor.getByTestId('ai-diagnostic-result')).toContainText(
    'The save handler rejects the missing identifier.',
  );
  const calls = await providerCalls();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).not.toContain(TEST_KEY);
  expect(calls[0]!.headers['x-goog-api-key']).toBe(TEST_KEY);
  const body = JSON.parse(calls[0]!.body);
  expect(body.contents[0].parts[0].text).toBe(preview);
  expect(body).not.toHaveProperty('tools');
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.generationConfig.responseJsonSchema.properties).toHaveProperty(
    'hypotheses',
  );
  const review = editor.getByLabel(
    'I reviewed the report and screenshot for private information.',
  );
  await expect(review).not.toBeChecked();
  await expect(
    editor.getByRole('button', { name: 'Export ZIP', exact: true }),
  ).toBeDisabled();
  // A slow worker acknowledgement must not undo the controlled checkbox click.
  await editor.evaluate(() => {
    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (async (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'UPDATE_REPORT'
      ) {
        chrome.runtime.sendMessage = sendMessage;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return sendMessage(message);
    }) as typeof chrome.runtime.sendMessage;
  });
  await review.check();
  await expect(
    editor.getByRole('button', { name: 'Export ZIP', exact: true }),
  ).toBeDisabled();
  await expect(
    editor.getByRole('button', { name: 'Export ZIP', exact: true }),
  ).toBeEnabled();
  const archive = unzipSync(await download(editor, 'Export ZIP'));
  const exported = JSON.parse(strFromU8(archive['report.json']!));
  expect(exported.schemaVersion).toBe('1.2.0');
  expect(exported.aiDiagnostic.summary).toBe(AI_SUMMARY);
  expect(exported.aiDiagnostic.hypotheses[0].explanation).toBe(AI_EXPLANATION);
  expect(exported.aiDiagnostic.model).toBe('gemini-3.5-flash-lite');
  expect(exported.aiDiagnostic.promptVersion).toBe('2.0.0');
  expect(exported.aiDiagnostic.reportId).toBe(exported.id);
  expect(exported.aiDiagnostic.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(exported.events.map((event: { id: string }) => event.id)).toEqual(
    expect.arrayContaining(exported.aiDiagnostic.evidenceIds),
  );
  const referenced = exported.aiDiagnostic.hypotheses[0].supportingEventIds[0];
  const eventReference = editor
    .locator('.ai-evidence-references summary')
    .filter({ hasText: referenced })
    .first();
  await eventReference.click();
  await expect(
    eventReference.locator('..').locator('.ai-evidence-detail'),
  ).toContainText('Demo:');
  await editor
    .getByRole('button', { name: 'Copy debugging steps', exact: true })
    .click();
  await expect(
    editor.getByText(/Debugging steps copied|Clipboard access is unavailable/),
  ).toBeVisible();
  expect(strFromU8(archive['report.md']!)).toContain('## AI diagnostic');
  expect(JSON.stringify(exported)).not.toContain(TEST_KEY);
  await mockScreenshot('ai-result');
  await editor
    .getByRole('button', { name: 'Remove analysis', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(editor.getByTestId('ai-diagnostic-result')).toHaveCount(0);
  await expect(review).not.toBeChecked();
  await editor.getByRole('button', { name: 'Delete', exact: true }).click();
  await editor
    .getByRole('button', { name: 'Delete all data', exact: true })
    .click();
  const status = await editor.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_AI_STATUS' }),
  );
  expect(status.settings).toEqual({ hasKey: false, remembered: false });
});

test('mocked Gemini quota failure preserves the local report and never retries automatically', async () => {
  await stoppedReport();
  await configureKey(true);
  await worker.evaluate(() => {
    const host = globalThis as typeof globalThis & {
      __geminiTest?: { status: number };
    };
    host.__geminiTest!.status = 429;
  });
  const initial = await editor.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_STATE' }),
  );
  await editor
    .getByRole('button', { name: 'Run AI Diagnostic', exact: true })
    .click();
  await editor.getByLabel(consentLabel).check();
  await editor
    .getByRole('button', { name: 'Send reviewed text to Gemini', exact: true })
    .click();
  await expect(editor.getByRole('alert')).toContainText('quota or rate limit');
  expect(await providerCalls()).toHaveLength(1);
  const result = await editor.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_STATE' }),
  );
  expect(result.state.report).toEqual(initial.state.report);
  // An explicit second consent is still subject to the persisted Retry-After delay.
  await editor
    .getByRole('button', { name: 'Run AI Diagnostic', exact: true })
    .click();
  await editor.getByLabel(consentLabel).check();
  await editor
    .getByRole('button', { name: 'Send reviewed text to Gemini', exact: true })
    .click();
  await expect(editor.getByRole('alert')).toContainText('Wait');
  expect(await providerCalls()).toHaveLength(1);
  await editor
    .getByRole('button', { name: 'Settings & privacy', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Remove API key', exact: true })
    .click();
  const status = await editor.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_AI_STATUS' }),
  );
  expect(status.settings).toEqual({ hasKey: false, remembered: false });
});

test('mocked Gemini uses the explicitly chosen model and approved transient retry policy', async () => {
  await stoppedReport();
  await configureKey();
  await editor
    .getByRole('button', { name: 'Settings & privacy', exact: true })
    .click();
  await editor
    .getByRole('combobox', { name: /^Gemini model/ })
    .selectOption('gemini-3.8-flash');
  await editor
    .getByLabel('Allow up to two retries for transient failures', {
      exact: true,
    })
    .check();
  await editor
    .getByRole('button', { name: 'Save AI configuration', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await editor.evaluate(() =>
            chrome.runtime.sendMessage({ type: 'GET_AI_STATUS' }),
          )
        ).configuration,
    )
    .toEqual({ model: 'gemini-3.8-flash', allowRetries: true });
  await editor.getByRole('button', { name: 'Bug report', exact: true }).click();
  await editor.getByRole('tab', { name: 'Preview', exact: true }).click();
  await worker.evaluate(() => {
    const host = globalThis as typeof globalThis & {
      __geminiTest?: { remainingTransient: number };
    };
    host.__geminiTest!.remainingTransient = 1;
  });
  await prepareConsent();
  await expect(editor.locator('.ai-consent')).toContainText('gemini-3.8-flash');
  await expect(editor.locator('.ai-consent')).toContainText(
    'Maximum 3 attempts',
  );
  await expect(editor.locator('.ai-retry-disclosure')).toContainText(
    'Each attempt may consume quota or incur charges',
  );
  await editor
    .getByRole('button', { name: 'Send reviewed text to Gemini', exact: true })
    .click();
  await expect(editor.getByTestId('ai-diagnostic-result')).toContainText(
    AI_SUMMARY,
  );
  const calls = await providerCalls();
  expect(calls).toHaveLength(2);
  expect(
    calls.every((call) =>
      call.url.includes('/gemini-3.8-flash:generateContent'),
    ),
  ).toBe(true);
  await expect(editor.getByTestId('ai-diagnostic-result')).toContainText(
    'gemini-3.8-flash',
  );
});
