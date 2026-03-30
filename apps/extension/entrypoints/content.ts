import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  CAPTURE_PAGE_MESSAGE_TYPE,
  type CapturePageMessageRequest,
  type CapturePageMessageResponse,
} from '../src/content-messages.js';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const request = message as CapturePageMessageRequest | null;
      if (!request || request.type !== CAPTURE_PAGE_MESSAGE_TYPE) {
        return undefined;
      }

      try {
        const html = document.documentElement?.outerHTML ?? '';
        const response: CapturePageMessageResponse = {
          ok: true,
          payload: {
            url: window.location.href,
            html,
          },
        };
        sendResponse(response);
      } catch (error) {
        const response: CapturePageMessageResponse = {
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to read page content.',
        };
        sendResponse(response);
      }

      return false;
    });
  },
});
