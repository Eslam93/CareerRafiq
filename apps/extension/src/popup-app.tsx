import { useEffect, useRef, useReducer, useState } from 'react';
import { createExtensionApiClient, ExtensionApiError } from './api-client.js';
import {
  CAPTURE_PAGE_MESSAGE_TYPE,
  type CapturedPagePayload,
  type CapturePageMessageRequest,
  type CapturePageMessageResponse,
} from './content-messages.js';
import { buildWebAppUrl, getApiBaseUrl } from './config.js';
import { createExtensionRuntime } from './runtime.js';
import {
  createInitialExtensionState,
  reduceExtensionState,
  type ExtensionQuickResultState,
  type ExtensionShellEvent,
} from './state.js';

type CaptureMode = 'idle' | 'capturing';

function formatVerdict(value: ExtensionQuickResultState['verdict']): string {
  if (value === 'apply') return 'Apply';
  if (value === 'consider') return 'Consider';
  if (value === 'skip') return 'Skip';
  return 'Pending';
}

function isCapturableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

async function getCurrentTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

function readCapturedPageFromTab(tabId: number): Promise<CapturedPagePayload> {
  return new Promise((resolve, reject) => {
    const request: CapturePageMessageRequest = { type: CAPTURE_PAGE_MESSAGE_TYPE };
    chrome.tabs.sendMessage(tabId, request, (response: CapturePageMessageResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from content script.'));
        return;
      }
      if (!response.ok) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.payload);
    });
  });
}

function openWebLink(url: string): void {
  void chrome.tabs.create({ url });
}

export function PopupApp(): JSX.Element {
  const [state, dispatch] = useReducer(reduceExtensionState, undefined, createInitialExtensionState);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('idle');
  const [sessionExpired, setSessionExpired] = useState(false);

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const apiClientRef = useRef<ReturnType<typeof createExtensionApiClient> | null>(null);
  if (!apiClientRef.current) {
    apiClientRef.current = createExtensionApiClient({ baseUrl: getApiBaseUrl() });
  }

  const runtimeRef = useRef<ReturnType<typeof createExtensionRuntime> | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createExtensionRuntime(
      {
        dispatch: (event: ExtensionShellEvent) => {
          dispatchRef.current(event);
        },
      },
      apiClientRef.current,
    );
  }

  async function recordPopupEvent(
    code: string,
    summary: string,
    payload: Record<string, unknown> = {},
    severity: 'info' | 'warning' | 'error' = 'info',
  ): Promise<void> {
    const apiClient = apiClientRef.current;
    if (!apiClient?.getEyeSessionId()) {
      return;
    }
    try {
      await apiClient.recordClientDiagnosticEvent({
        area: 'extension',
        stage: 'popup',
        code,
        severity,
        summary,
        requestId: apiClient.getLastRequestId(),
        payload,
        clientSurface: 'extension',
      });
    } catch {
      // Eye diagnostics are best-effort only.
    }
  }

  useEffect(() => {
    let cancelled = false;
    void apiClientRef.current?.getSession()
      .then((session) => {
        if (!cancelled) {
          setSessionExpired(!session.authenticated);
          if (!session.authenticated) {
            apiClientRef.current?.setEyeSessionId(null);
          }
          void apiClientRef.current?.getCurrentEyeSession()
            .then((eyeCurrent) => {
              if (cancelled) {
                return;
              }
              apiClientRef.current?.setEyeSessionId(eyeCurrent.session?.id ?? null);
              if (eyeCurrent.session?.id) {
                void recordPopupEvent('extension_popup_opened', 'Extension popup opened.', {
                  authenticated: session.authenticated,
                });
              }
            })
            .catch(() => {
              if (!cancelled) {
                apiClientRef.current?.setEyeSessionId(null);
              }
            });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessionExpired(false);
          apiClientRef.current?.setEyeSessionId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCapture = async (): Promise<void> => {
    setSessionExpired(false);
    setCaptureMode('capturing');
    try {
      const tab = await getCurrentTab();
      if (!tab || typeof tab.id !== 'number') {
        dispatch({
          type: 'CAPTURE_FAILED',
          message: 'Unable to access the active tab.',
        });
        return;
      }

      if (!isCapturableUrl(tab.url)) {
        await recordPopupEvent('extension_popup_unsupported_branch', 'Popup detected a non-capturable URL.', {
          pageUrl: tab.url ?? null,
        }, 'warning');
        dispatch(
          tab.url
            ? {
                type: 'UNSUPPORTED_PAGE',
                pageUrl: tab.url,
                reason: 'Only HTTP(S) pages are supported. Open a job page and retry.',
                eyeSessionId: apiClientRef.current?.getEyeSessionId() ?? null,
              }
            : {
                type: 'UNSUPPORTED_PAGE',
                reason: 'Only HTTP(S) pages are supported. Open a job page and retry.',
                eyeSessionId: apiClientRef.current?.getEyeSessionId() ?? null,
              },
        );
        return;
      }

      const payload = await readCapturedPageFromTab(tab.id);
      const runtime = runtimeRef.current;
      if (!runtime) {
        throw new Error('Runtime initialization failed.');
      }
      await runtime.captureAndEvaluate({
        pageUrl: payload.url,
        pageContent: payload.html,
      });
    } catch (error) {
      if (error instanceof ExtensionApiError && error.status === 401) {
        setSessionExpired(true);
        await recordPopupEvent('extension_popup_session_expired', 'Session expired during extension capture.', {
          pageUrl: state.pageUrl,
        }, 'warning');
        dispatch({
          type: 'CAPTURE_FAILED',
          message: 'Session expired. Sign in again from the web app.',
          requestId: error.requestId,
          eyeSessionId: apiClientRef.current?.getEyeSessionId() ?? null,
        });
      } else {
        const message = error instanceof Error ? error.message : 'Capture failed unexpectedly.';
        dispatch({
          type: 'CAPTURE_FAILED',
          message,
          requestId: error instanceof ExtensionApiError ? error.requestId : apiClientRef.current?.getLastRequestId() ?? null,
          eyeSessionId: apiClientRef.current?.getEyeSessionId() ?? null,
        });
      }
    } finally {
      setCaptureMode('idle');
    }
  };

  const openManualCapture = (): void => {
    openWebLink(
      buildWebAppUrl('/capture/manual', {
        sourceUrl: state.pageUrl,
      }),
    );
  };

  const openReview = (): void => {
    if (!state.jobId) {
      openManualCapture();
      return;
    }
    openWebLink(buildWebAppUrl(`/jobs/${state.jobId}/review`));
  };

  const openTracker = (): void => {
    const trackerJobId = state.quickResult?.trackerItem?.jobId ?? state.jobId;
    if (!trackerJobId) {
      openWebLink(buildWebAppUrl('/tracker'));
      return;
    }
    openWebLink(buildWebAppUrl(`/tracker/${trackerJobId}`));
  };

  const openLogin = (): void => {
    openWebLink(
      buildWebAppUrl('/login', {
        returnTo: state.pageUrl ?? undefined,
      }),
    );
  };

  const openEyeConsole = (): void => {
    openWebLink(
      buildWebAppUrl('/ops/eye', {
        eyeSessionId: state.eyeSessionId ?? apiClientRef.current?.getEyeSessionId() ?? undefined,
        requestId: state.requestId ?? apiClientRef.current?.getLastRequestId() ?? undefined,
        jobId: state.jobId ?? undefined,
      }),
    );
  };

  return (
    <main className="crx-root">
      <header className="crx-header">
        <div>
          <h1 className="crx-brand">CareerRafiq</h1>
          <p className="crx-subtle">Extension Beta</p>
        </div>
        <button
          type="button"
          className="crx-secondary"
          onClick={() => dispatch({ type: 'RESET' })}
          disabled={captureMode === 'capturing'}
        >
          Reset
        </button>
      </header>

      <section className="crx-panel">
        {state.status === 'idle' && (
          <>
            {sessionExpired ? (
              <>
                <p className="crx-copy">Sign in to the web app before capturing jobs from the extension.</p>
                <button type="button" className="crx-primary" onClick={openLogin}>
                  Sign in
                </button>
              </>
            ) : (
              <>
                <p className="crx-copy">
                  Capture this page to extract the job and run deterministic CV-fit evaluation.
                </p>
                <button type="button" className="crx-primary" onClick={handleCapture} disabled={captureMode === 'capturing'}>
                  {captureMode === 'capturing' ? 'Capturing...' : 'Capture Current Page'}
                </button>
              </>
            )}
          </>
        )}

        {state.status === 'loading' && (
          <>
            <p className="crx-copy">Extracting and evaluating this page.</p>
            <div className="crx-loader" />
          </>
        )}

        {state.status === 'unsupported_page' && (
          <>
            <p className="crx-title">Unsupported page</p>
            <p className="crx-copy">{state.unsupportedReason ?? 'Use manual paste fallback in web app.'}</p>
            <button type="button" className="crx-primary" onClick={openManualCapture}>
              Open Manual Capture
            </button>
          </>
        )}

        {state.status === 'review_required' && (
          <>
            <p className="crx-title">Review required</p>
            <p className="crx-copy">Low confidence or missing fields were detected. Confirm details in the web app.</p>
            {state.requestId ? <p className="crx-copy">Request ID: {state.requestId}</p> : null}
            {state.reviewReasons.length > 0 && (
              <ul className="crx-list">
                {state.reviewReasons.slice(0, 4).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            <div className="crx-actions">
              <button type="button" className="crx-primary" onClick={openReview}>
                Open Review
              </button>
              {(state.requestId || state.eyeSessionId) ? (
                <button type="button" className="crx-secondary" onClick={openEyeConsole}>
                  Open Eye Console
                </button>
              ) : null}
            </div>
          </>
        )}

        {state.status === 'result' && state.quickResult && (
          <>
            <p className="crx-title">Quick result</p>
            <div className="crx-result-row">
              <span className="crx-key">Verdict</span>
              <span className="crx-value">{formatVerdict(state.quickResult.verdict)}</span>
            </div>
            <div className="crx-result-row">
              <span className="crx-key">Recommended CV</span>
              <span className="crx-value">{state.quickResult.recommendedCvName ?? state.quickResult.recommendedCvId ?? 'No recommendation'}</span>
            </div>
            <div className="crx-result-block">
              <span className="crx-key">Concise explanation</span>
              <p className="crx-copy">{state.quickResult.conciseExplanation || 'No explanation available.'}</p>
            </div>
            <div className="crx-result-block">
              <span className="crx-key">Major gaps summary</span>
              <ul className="crx-list">
                {(state.quickResult.majorGapsSummary.length > 0
                  ? state.quickResult.majorGapsSummary
                  : ['No major gaps identified.']
                ).map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
            {state.requestId ? <p className="crx-copy">Request ID: {state.requestId}</p> : null}
            <button type="button" className="crx-primary" onClick={openTracker}>
              Open in Tracker
            </button>
          </>
        )}

        {state.status === 'error' && (
          <>
            <p className="crx-title">Capture failed</p>
            <p className="crx-copy">{state.errorMessage ?? 'Something went wrong.'}</p>
            {state.requestId ? <p className="crx-copy">Request ID: {state.requestId}</p> : null}
            <div className="crx-actions">
              <button type="button" className="crx-primary" onClick={handleCapture}>
                Retry capture
              </button>
              <button type="button" className="crx-secondary" onClick={openManualCapture}>
                Manual fallback
              </button>
              {(state.requestId || state.eyeSessionId) ? (
                <button type="button" className="crx-secondary" onClick={openEyeConsole}>
                  Open Eye Console
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>

      <footer className="crx-footer">
        <button type="button" className="crx-link" onClick={() => openWebLink(buildWebAppUrl('/tracker'))}>
          Open web app
        </button>
        {sessionExpired && (
          <button type="button" className="crx-link" onClick={openLogin}>
            Sign in again
          </button>
        )}
      </footer>
    </main>
  );
}
