// Flask backend client shared by the portfolio and data-source screens.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1').replace(/\/$/, '');
export const PORTFOLIO_ID = import.meta.env.VITE_PORTFOLIO_ID || 'SYN-PORT-142';

export async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options);
  } catch {
    throw new Error(`The backend at ${API_BASE_URL} is not reachable`);
  }
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status})`);
  return body;
}

export const apiGet = (path) => apiRequest(path);
