// Flask backend client shared by the portfolio and data-source screens.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1').replace(/\/$/, '');
export const PORTFOLIO_ID = import.meta.env.VITE_PORTFOLIO_ID || 'SYN-PORT-142';

// Browser-side log: console lines prefixed [Furika], plus the last 300 events in window.furikaLog for copying into a bug report.
const HISTORY = [];
const remember = (level, message, data) => {
  HISTORY.push({ time: new Date().toISOString(), level, message, ...(data ? { data } : {}) });
  if (HISTORY.length > 300) HISTORY.shift();
};
if (typeof window !== 'undefined') window.furikaLog = HISTORY;

export const log = {
  debug: (message, data) => { remember('debug', message, data); console.debug('[Furika]', message, data ?? ''); },
  info: (message, data) => { remember('info', message, data); console.info('[Furika]', message, data ?? ''); },
  warn: (message, data) => { remember('warn', message, data); console.warn('[Furika]', message, data ?? ''); },
  error: (message, data) => { remember('error', message, data); console.error('[Furika]', message, data ?? ''); },
};

export class ApiError extends Error {
  constructor(message, { status = 0, requestId = null, body = {} } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
    this.step = body.step || null;      // the model-run step that stopped, when the backend traced one
    this.trace = body.trace || null;
    this.body = body;
  }
}

const newRequestId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '').slice(0, 12);
const isWorkflowCall = (path) => path.startsWith('/model-runs');

// Print a backend step trace as a console table; failed traces open expanded.
export function logTrace(trace, label = trace?.action) {
  if (!trace?.steps) return;
  const failed = trace.steps.find((step) => step.status !== 'ok');
  const title = `[Furika] ${label} trace=${trace.traceId} ${failed ? `stopped at ${failed.step} (${failed.status})` : `ok in ${trace.totalMs} ms`}`;
  (failed ? console.group : console.groupCollapsed)(title);
  console.table(trace.steps.map(({ step, status, ms, detail, error }) => ({ step, status, ms, detail: JSON.stringify(detail || {}), error: error || '' })));
  console.groupEnd();
  remember(failed ? 'error' : 'info', title, trace);
}

// One readable line for the UI: the message, plus the failing step and trace ID when the backend gave them.
export function describeError(error) {
  const extras = [error.step && `step: ${error.step}`, error.requestId && `trace: ${error.requestId}`].filter(Boolean);
  return extras.length ? `${error.message} (${extras.join(' · ')})` : error.message;
}

export async function apiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const requestId = newRequestId();
  const started = performance.now();
  const workflow = isWorkflowCall(path);
  if (workflow) log.info(`→ ${method} ${path}`, { requestId });
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers: { ...(options.headers || {}), 'X-Request-ID': requestId } });
  } catch (cause) {
    log.error(`✕ ${method} ${path}: backend not reachable at ${API_BASE_URL}`, { requestId, cause: String(cause) });
    throw new ApiError(`The backend at ${API_BASE_URL} is not reachable`, { requestId });
  }
  const ms = Math.round(performance.now() - started);
  const serverId = response.headers.get('X-Request-ID') || requestId;
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    log.error(`✕ ${method} ${path} → ${response.status} in ${ms} ms${body.step ? ` at step ${body.step}` : ''}: ${body.message || 'no message'}`, { requestId: serverId, body });
    if (body.trace) logTrace(body.trace);
    throw new ApiError(body.message || `Request failed (${response.status})`, { status: response.status, requestId: serverId, body });
  }
  (workflow ? log.info : log.debug)(`← ${method} ${path} → ${response.status} in ${ms} ms`, { requestId: serverId });
  if (body?.trace) logTrace(body.trace);
  return body;
}

export const apiGet = (path) => apiRequest(path);
