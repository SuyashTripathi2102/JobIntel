/** Tiny API client: JWT in localStorage, 401 → /login. */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('careeros_token');
}

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('Invalid credentials');
  const data = (await res.json()) as { accessToken: string };
  localStorage.setItem('careeros_token', data.accessToken);
}

export function logout(): void {
  localStorage.removeItem('careeros_token');
  window.location.href = '/login';
}

async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  if (!token) {
    window.location.href = '/login';
    throw new Error('Not authenticated');
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401) {
    logout();
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>('GET', path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>('POST', path, body);
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>('PATCH', path, body);
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>('PUT', path, body);
}

/** Multipart upload — never set content-type, the browser writes the boundary. */
export async function apiUpload<T>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<T> {
  const token = getToken();
  if (!token) {
    window.location.href = '/login';
    throw new Error('Not authenticated');
  }
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (res.status === 401) {
    logout();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const detail: unknown = await res.json().catch(() => null);
    const message = (detail as { message?: string } | null)?.message;
    throw new Error(message ?? `API ${res.status}`);
  }
  return (await res.json()) as T;
}
