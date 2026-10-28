import { API_PREFIX, type HealthResponse, type LoginResponse } from '@halko/shared';

const TOKEN_KEY = 'halko.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(`${API_PREFIX}${path}`, { ...init, headers });
  if (res.status === 401 && token) {
    setToken(null);
    for (const l of unauthorizedListeners) l();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? 'error');
  }
  return (await res.json()) as T;
}

// Version of the server, which serves this app too (null when it cannot be reached).
export async function serverVersion(): Promise<string | null> {
  try {
    const res = await fetch('/api/health');
    return res.ok ? ((await res.json()) as HealthResponse).version : null;
  } catch {
    return null;
  }
}

export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return 'PC Windows';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'PC Linux';
  return 'Navigateur';
}

export async function login(password: string, deviceName = guessDeviceName()): Promise<void> {
  const res = await api<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ password, deviceName }) });
  setToken(res.token);
}

export async function logout(): Promise<void> {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  setToken(null);
  for (const l of unauthorizedListeners) l();
}
