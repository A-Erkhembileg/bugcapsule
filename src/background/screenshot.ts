import { MAX_SCREENSHOT_LENGTH, screenshotSchema } from '../core';

/** captureVisibleTab accepts a window, not a document. Discard the result if the target changes. */
export async function captureScreenshot(api: typeof chrome, tabId: number, documentId: string) {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== tabId || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    throw new Error('Open the original captured webpage and take the screenshot from its ReproQuill toolbar popup.');
  }
  let changed = false;
  const onActivate = (active: chrome.tabs.OnActivatedInfo) => {
    if (active.windowId === tab.windowId) changed = true;
  };
  const onUpdate = (updatedId: number, change: chrome.tabs.OnUpdatedInfo) => {
    if (updatedId === tabId && change.status === 'loading') changed = true;
  };
  const verifyDocument = async () => {
    const [active] = await api.tabs.query({ active: true, windowId: tab.windowId });
    if (!changed && active?.id === tabId) {
      // Inject into the current top frame; the browser supplies the document ID.
      const [result] = await api.scripting.executeScript({
        target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: () => document.visibilityState === 'visible',
      });
      if (!changed && result?.documentId === documentId && result.result === true) return;
    }
    throw new Error('The tab or document changed. Return to the captured webpage or start a new capture.');
  };
  api.tabs.onActivated.addListener(onActivate);
  api.tabs.onUpdated.addListener(onUpdate);
  let dataUrl: string;
  try {
    await verifyDocument();
    dataUrl = await api.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await verifyDocument();
  } catch {
    throw new Error('Screenshot unavailable. Open the toolbar popup on the original document and retry. If the page reloaded or navigated, start a new capture.');
  } finally {
    api.tabs.onActivated.removeListener(onActivate);
    api.tabs.onUpdated.removeListener(onUpdate);
  }
  if (dataUrl.length > MAX_SCREENSHOT_LENGTH) {
    throw new Error('Screenshot is too large for private session storage. Reduce the browser window size and retake it.');
  }
  // PNG IHDR stores the actual pixel dimensions in bytes 16–23.
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) throw new Error('Invalid screenshot returned by the browser.');
  const bytes = Uint8Array.from(atob(dataUrl.slice(prefix.length, prefix.length + 48)), char => char.charCodeAt(0));
  if (bytes.length < 24) throw new Error('Invalid screenshot returned by the browser.');
  const header = new DataView(bytes.buffer);
  return screenshotSchema.parse({ dataUrl, width: header.getUint32(16), height: header.getUint32(20), redacted: false });
}
