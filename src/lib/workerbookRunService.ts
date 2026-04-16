// src/lib/workerbookRunService.ts
//
// Calls the Google Apps Script Web App that triggers runMoveLogic for a given tab.
// The Web App is deployed from RunLogic.gs (doPost/doGet wrapper).
//
// Key behaviors:
// - Single-flight: only one Run can be in-flight at a time per CC. Subsequent
//   calls while one is running will be rejected with a clear message.
// - Timeout: Google Apps Script has a 6-minute execution limit, but we time out
//   at 2 minutes since runMoveLogic is typically 30-90 seconds.
// - Expects a JSON response like: {success: true, tabName: "Apr16", message: "..."}
//   or {success: false, error: "..."}.

const RUN_TIMEOUT_MS = 120_000; // 2 minutes

/** Tracks which CC has an in-flight run, by CC ID */
const activeRuns = new Map<string, AbortController>();

export interface RunResult {
  success: boolean;
  error?: string;
  message?: string;
  tabName?: string;
}

/**
 * Is there currently a Run in flight for this command center?
 */
export function isRunInFlight(commandCenterId: string): boolean {
  return activeRuns.has(commandCenterId);
}

/**
 * Trigger runMoveLogic on the given tab via the deployed Web App URL.
 *
 * @param commandCenterId  Used to enforce single-flight per CC
 * @param webAppUrl        The deployed Google Apps Script Web App URL
 * @param tabName          The tab to activate and run on (the SOURCE tab)
 * @returns                A RunResult with success/error info
 */
export async function triggerRunLogic(
  commandCenterId: string,
  webAppUrl: string | undefined,
  tabName: string,
): Promise<RunResult> {
  if (!webAppUrl || !webAppUrl.trim()) {
    return {
      success: false,
      error: 'No Workerbook Run URL configured for this command center. Ask your admin to set one in the command center settings.',
    };
  }

  if (!tabName || !tabName.trim()) {
    return { success: false, error: 'No tab name provided.' };
  }

  // Single-flight check
  if (activeRuns.has(commandCenterId)) {
    return {
      success: false,
      error: 'Another move is already running. Please wait for it to finish before trying again.',
    };
  }

  const abortController = new AbortController();
  activeRuns.set(commandCenterId, abortController);

  // Timeout safety net
  const timeoutId = setTimeout(() => abortController.abort(), RUN_TIMEOUT_MS);

  try {
    // IMPORTANT: Google Apps Script Web Apps do not support custom headers or
    // preflight CORS, so we use a simple POST with text/plain and stringify JSON
    // in the body. The doPost function in RunLogic.gs parses e.postData.contents.
    const response = await fetch(webAppUrl, {
      method: 'POST',
      body: JSON.stringify({ tabName }),
      signal: abortController.signal,
      // Using text/plain keeps this a "simple" CORS request — no preflight.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Run endpoint returned HTTP ${response.status}. Check the Web App URL is correct and deployed with "Anyone" access.`,
      };
    }

    const text = await response.text();

    // Try to parse as JSON
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // If Google redirected to a login page or returned HTML, surface that
      return {
        success: false,
        error: 'Run endpoint returned non-JSON response. The Web App may not be deployed with "Anyone" access, or the URL is wrong.',
      };
    }

    if (data?.success === true) {
      return {
        success: true,
        tabName: data.tabName,
        message: data.message || 'Move complete.',
      };
    }

    return {
      success: false,
      error: data?.error || 'Unknown error from Run script.',
    };

  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        success: false,
        error: 'Move timed out after 2 minutes. The Google Apps Script may still be running — check your spreadsheet manually in a moment.',
      };
    }
    return {
      success: false,
      error: err?.message || 'Network error contacting the Run endpoint.',
    };
  } finally {
    clearTimeout(timeoutId);
    activeRuns.delete(commandCenterId);
  }
}