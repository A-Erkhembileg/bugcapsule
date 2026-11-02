import { CaptureController } from './controller';
import { AICoordinator, AI_COMMANDS } from '../services/aiCoordinator';

const controller = new CaptureController();
const ai = new AICoordinator(controller);
void ai.initialize().catch(() => undefined);
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    typeof message.type === 'string' &&
    AI_COMMANDS.has(message.type)
  ) {
    void ai.handle(message, sender).then(respond);
    return true;
  }
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'DELETE_ALL' &&
    sender.id === chrome.runtime.id &&
    sender.url?.split(/[?#]/, 1)[0] === chrome.runtime.getURL('index.html') &&
    (sender.frameId === undefined || sender.frameId === 0)
  ) {
    void ai
      .deleteAll<Awaited<ReturnType<typeof controller.handle>>>(() =>
        controller.handle(message, sender),
      )
      .then(respond)
      .catch(() =>
        respond({
          ok: false,
          error: 'Some local data could not be deleted. Retry Delete all data.',
        }),
      );
    return true;
  }
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'CAPTURE_EVENT'
  ) {
    void controller
      .receiveEvent(message, sender)
      .then(() => respond({ ok: true }));
  } else {
    void controller.handle(message, sender).then(respond);
  }
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') void controller.tabEnded(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void controller.tabEnded(tabId);
});
