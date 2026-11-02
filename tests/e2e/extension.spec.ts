import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

let context: BrowserContext;
let extensionId: string;
let browserCDP: CDPSession;

test.beforeEach(async () => {
  const extensionPath = path.resolve('dist');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    executablePath: process.env.BUGCAPSULE_BROWSER_EXECUTABLE,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  // These CDP commands require the browser target, not a page session.
  browserCDP = await context.browser()!.newBrowserCDPSession();
  await browserCDP.send('Extensions.loadUnpacked', { path: extensionPath });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});
test.afterEach(async () => {
  await context?.close();
});

async function toolbarClick(
  demo: Page,
  editor: Page,
  button: string,
  enableTimeline = false,
) {
  // Toolbar popups are real extension views, but Playwright omits them from context.pages().
  // Get the view from the same-origin editor and click the actual rendered control.
  const hasPopup = await editor.evaluate(
    () => chrome.extension.getViews({ type: 'popup' }).length > 0,
  );
  if (!hasPopup) {
    await demo.bringToFront();
    const { targetInfos } = await browserCDP.send('Target.getTargets', {
      filter: [{ type: 'tab' }],
    });
    const target = targetInfos.find((item) => item.url === demo.url());
    if (!target) throw new Error('The demo tab target was unavailable.');
    await browserCDP.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: target.targetId,
    });
  }
  await expect
    .poll(() =>
      editor.evaluate(
        ({ button, enableTimeline }) => {
          const view = chrome.extension.getViews({ type: 'popup' })[0];
          if (!view) return false;
          const control = Array.from(
            view.document.querySelectorAll('button'),
          ).find((element) => element.textContent?.trim() === button);
          if (!control || control.disabled) return false;
          const timeline = view.document.querySelector<HTMLInputElement>(
            '.capture-options input[type=checkbox]',
          );
          if (enableTimeline && timeline && !timeline.checked) timeline.click();
          control.click();
          return true;
        },
        { button, enableTimeline },
      ),
    )
    .toBe(true);
}

async function documentationScreenshot(page: Page, name: string) {
  if (process.env.BUGCAPSULE_DOC_SCREENSHOTS !== '1') return;
  await mkdir('docs/images', { recursive: true });
  await page.screenshot({
    path: `docs/images/${name}.png`,
    fullPage: name.startsWith('report-editor'),
  });
}

async function downloadReport(editor: Page, buttonName: string) {
  const downloading = editor.waitForEvent('download');
  await editor.getByRole('button', { name: buttonName, exact: true }).click();
  const download = await downloading;
  const filename = await download.path();
  if (!filename) throw new Error(`Could not read the ${buttonName} download.`);
  return readFile(filename);
}

test('real MV3 capture, redact, export, delete, and repeat with production permissions', async () => {
  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/index.html?view=full`);
  await expect(
    editor.getByText('Ready when you are', { exact: true }),
  ).toBeVisible();
  await documentationScreenshot(editor, 'dashboard');
  const demo = await context.newPage();
  await demo.goto('http://127.0.0.1:4173/?token=fake-query-secret');
  await demo.evaluate(() => console.error('before-capture-must-not-appear'));
  await toolbarClick(demo, editor, 'Start capture', true);
  await expect(
    editor.getByText('Capture is active', { exact: true }),
  ).toBeVisible();
  await demo.locator('#private-field').fill('private-input-must-not-appear');
  await demo.locator('#throw-error').click();
  await demo.locator('#reject-promise').click();
  await demo.locator('#console-error').click();
  await expect
    .poll(async () => {
      const value = await editor.evaluate(async () =>
        chrome.runtime.sendMessage({ type: 'GET_STATE' }),
      );
      return value.state.report.events.filter((event: { kind: string }) =>
        ['error', 'unhandled-rejection', 'console-error'].includes(event.kind),
      ).length;
    })
    .toBe(3);
  await toolbarClick(demo, editor, 'Screenshot');
  await expect(editor.getByText('Attached', { exact: true })).toBeVisible();
  await toolbarClick(demo, editor, 'Stop capture');
  await expect(
    editor.getByText('Capture stopped', { exact: true }),
  ).toBeVisible();
  await editor.bringToFront();
  const detailsTab = editor.getByRole('tab', { name: 'Report details' });
  const evidenceTab = editor.getByRole('tab', { name: 'Evidence' });
  const previewTab = editor.getByRole('tab', { name: 'Preview' });
  await detailsTab.focus();
  await editor.keyboard.press('ArrowRight');
  await expect(evidenceTab).toHaveAttribute('aria-selected', 'true');
  await expect(evidenceTab).toBeFocused();
  await editor.keyboard.press('ArrowRight');
  await expect(previewTab).toHaveAttribute('aria-selected', 'true');
  await editor.keyboard.press('Home');
  await expect(detailsTab).toHaveAttribute('aria-selected', 'true');
  await expect(detailsTab).toBeFocused();
  await editor.getByRole('tab', { name: 'Evidence' }).click();
  await expect(editor.locator('canvas')).toBeVisible();
  const samplePixel = () =>
    editor
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) =>
        Array.from(canvas.getContext('2d')!.getImageData(20, 20, 1, 1).data),
      );
  await expect(
    editor.getByLabel('Redaction width', { exact: true }),
  ).toBeEnabled();
  expect(await samplePixel()).not.toEqual([0, 0, 0, 255]);
  await editor.getByLabel('Redaction x', { exact: true }).fill('0');
  await editor.getByLabel('Redaction y', { exact: true }).fill('0');
  await editor.getByLabel('Redaction width', { exact: true }).fill('100');
  await editor.getByLabel('Redaction height', { exact: true }).fill('100');
  await editor.getByRole('button', { name: 'Apply redaction' }).click();
  await expect.poll(samplePixel).toEqual([0, 0, 0, 255]);
  await editor.getByRole('tab', { name: 'Report details' }).click();
  await editor
    .getByLabel('Bug title', { exact: true })
    .fill('Saving a draft leaves the interface stuck');
  await editor
    .getByLabel('Description', { exact: true })
    .fill('The demonstration save action fails.');
  await editor
    .getByLabel('Expected behavior', { exact: true })
    .fill('The draft is saved.');
  await editor
    .getByLabel('Actual behavior', { exact: true })
    .fill('Saving stays pending and an error is raised.');
  await editor
    .getByTestId('reproduction-steps')
    .fill(
      'Open the demonstration page\nClick Save draft\nObserve the stuck state',
    );
  await editor.getByRole('button', { name: 'Save changes' }).click();
  const review = editor.getByLabel(
    'I reviewed the report and screenshot for private information.',
  );
  await review.click();
  await expect(review).toBeChecked();
  await expect(
    editor.getByRole('button', { name: 'Export ZIP' }),
  ).toBeEnabled();
  const archive = unzipSync(await downloadReport(editor, 'Export ZIP'));
  expect(Object.keys(archive)).toEqual([
    'report.md',
    'report.json',
    'screenshot.png',
  ]);
  expect(await downloadReport(editor, 'JSON')).toEqual(
    Buffer.from(archive['report.json']!),
  );
  expect(await downloadReport(editor, 'Markdown')).toEqual(
    Buffer.from(archive['report.md']!),
  );
  // Decode the actual exported bytes separately from the editor's preview canvas.
  const exportedPixel = await editor.evaluate(async (encoded) => {
    const data = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const image = await createImageBitmap(
      new Blob([data], { type: 'image/png' }),
    );
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 20, 20, 1, 1, 0, 0, 1, 1);
    image.close();
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }, Buffer.from(archive['screenshot.png']!).toString('base64'));
  expect(exportedPixel).toEqual([0, 0, 0, 255]);
  const json = strFromU8(archive['report.json']!);
  expect(json).not.toContain('fake-query-secret');
  expect(json).not.toContain('fake-demo-token');
  expect(json).not.toContain('private-input-must-not-appear');
  expect(json).not.toContain('never-serialize-this-object');
  expect(json).not.toContain('before-capture-must-not-appear');
  const report = JSON.parse(json);
  expect(report.schemaVersion).toBe('1.2.0');
  expect(report.events.map((event: { kind: string }) => event.kind)).toEqual(
    expect.arrayContaining([
      'click',
      'error',
      'console-error',
      'unhandled-rejection',
    ]),
  );
  expect(report.steps).toHaveLength(3);
  expect(report.screenshot.redacted).toBe(true);
  expect(strFromU8(archive['report.md']!)).toContain('Saving a draft');
  await expect(editor.getByLabel('Bug title', { exact: true })).toHaveValue(
    report.title,
  );
  await editor.evaluate(() => window.scrollTo(0, 0));
  await documentationScreenshot(editor, 'report-editor');
  await editor.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(editor.locator('html')).toHaveAttribute('data-theme', 'light');
  await documentationScreenshot(editor, 'report-editor-light');
  if (process.env.BUGCAPSULE_DOC_SCREENSHOTS === '1') {
    await editor.getByRole('tab', { name: 'Evidence' }).click();
    await editor
      .locator('.screenshot-panel')
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await documentationScreenshot(editor, 'screenshot-review');
  }
  await editor.getByRole('button', { name: 'Delete', exact: true }).click();
  await editor
    .getByRole('button', { name: 'Delete all data', exact: true })
    .click();
  await expect(
    editor.getByText('A better bug report starts here.'),
  ).toBeVisible();
  await demo.bringToFront();
  await toolbarClick(demo, editor, 'Start capture');
  await expect(
    editor.getByText('Capture is active', { exact: true }),
  ).toBeVisible();
  await demo.locator('#throw-error').click();
  await expect
    .poll(
      async () =>
        (
          await editor.evaluate(async () =>
            chrome.runtime.sendMessage({ type: 'GET_STATE' }),
          )
        ).state.report.events.length,
    )
    .toBeGreaterThan(0);
  await demo.reload();
  await expect(
    editor.getByText('Capture stopped', { exact: true }),
  ).toBeVisible();
});

test('fails safely on restricted pages and has only the documented permissions', async () => {
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage']);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/index.html?view=full`);
  await editor
    .getByRole('button', { name: 'Start capture', exact: true })
    .click();
  await expect(editor.getByRole('alert')).toContainText(
    'Open an HTTP or HTTPS webpage',
  );
  await expect(
    editor.getByText('Ready when you are', { exact: true }),
  ).toBeVisible();
});

test('imports legacy JSON locally, preserves legacy analysis and confirms replacements before changing the report', async () => {
  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/index.html?view=full`);
  const legacy = {
    schemaVersion: '1.1.0',
    id: 'legacy-import-report',
    createdAt: '2026-11-01T12:00:00.000Z',
    title: 'Imported legacy save failure',
    description: 'A synthetic report from the older text-analysis format.',
    expectedBehavior: 'The save completes.',
    actualBehavior: 'The handler fails.',
    steps: ['Open the demo', 'Click Save draft'],
    environment: {
      url: 'https://demo.test/save?token=private-import-query',
      browser: 'Synthetic Chromium',
      viewport: { width: 800, height: 600, devicePixelRatio: 1 },
      language: 'en',
    },
    events: [
      {
        id: 'legacy-error',
        kind: 'error',
        timestamp: '2026-11-01T12:00:00.050Z',
        offsetMs: 50,
        message: 'Synthetic missing identifier',
        source: 'https://demo.test/save.js',
      },
    ],
    screenshot: {
      file: 'screenshot.png',
      mimeType: 'image/png',
      width: 800,
      height: 600,
      redacted: true,
    },
    aiDiagnostic:
      'Legacy hypothesis: inspect the save identifier. No source test was run.',
    privacyReviewed: true,
  };
  const choose = async (value: unknown) =>
    editor
      .getByTestId('report-import-file')
      .setInputFiles({
        name: 'synthetic-report.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(value)),
      });
  const saved = () =>
    editor.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: 'GET_STATE' })).state,
    );
  await choose(legacy);
  await expect(
    editor.getByRole('region', { name: 'Confirm report import' }),
  ).toBeVisible();
  expect((await saved()).report).toBeNull();
  await editor
    .getByRole('button', { name: 'Import report', exact: true })
    .click();
  await expect(editor.getByLabel('Bug title', { exact: true })).toHaveValue(
    legacy.title,
  );
  const imported = await saved();
  expect(imported.active).toBe(false);
  expect(imported.report.privacyReviewed).toBe(false);
  expect(imported.report.aiDiagnostic).toBe(legacy.aiDiagnostic);
  expect(imported.report.schemaVersion).toBe('1.1.0');
  expect(imported.report.screenshot).toBeUndefined();
  expect(imported.report.environment.url).toBe('https://demo.test/save');
  await editor.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(editor.getByTestId('ai-diagnostic-result')).toHaveText(
    legacy.aiDiagnostic,
  );
  await expect(
    editor.getByText(
      'Legacy text diagnostic. Its model, prompt version and generation time were not recorded.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    editor.getByRole('button', { name: 'Run AI Diagnostic', exact: true }),
  ).toBeDisabled();
  const status = await editor.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_AI_STATUS' }),
  );
  expect(status.settings.hasKey).toBe(false);
  expect(
    await editor.evaluate(() =>
      chrome.permissions.contains({
        origins: ['https://generativelanguage.googleapis.com/*'],
      }),
    ),
  ).toBe(false);
  await choose({
    ...legacy,
    id: 'cancelled-replacement',
    title: 'This replacement must not be saved',
  });
  await expect(
    editor.getByText('Replace the current report with this import?', {
      exact: true,
    }),
  ).toBeVisible();
  await editor
    .getByRole('button', { name: 'Cancel import', exact: true })
    .click();
  expect((await saved()).report.id).toBe(legacy.id);
  expect((await saved()).report.title).toBe(legacy.title);
  await choose({
    ...legacy,
    id: 'approved-replacement',
    title: 'Approved replacement report',
  });
  await editor
    .getByRole('button', { name: 'Import report', exact: true })
    .click();
  await expect(editor.getByLabel('Bug title', { exact: true })).toHaveValue(
    'Approved replacement report',
  );
  expect((await saved()).report.id).toBe('approved-replacement');
  expect((await saved()).report.privacyReviewed).toBe(false);
});
