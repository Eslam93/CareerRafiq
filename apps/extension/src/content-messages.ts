export const CAPTURE_PAGE_MESSAGE_TYPE = 'CAREER_RAFIQ_CAPTURE_PAGE';

export interface CapturedPagePayload {
  url: string;
  html: string;
}

export interface CapturePageMessageRequest {
  type: typeof CAPTURE_PAGE_MESSAGE_TYPE;
}

export type CapturePageMessageResponse =
  | { ok: true; payload: CapturedPagePayload }
  | { ok: false; error: string };
