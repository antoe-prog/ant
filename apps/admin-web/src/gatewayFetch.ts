export type FetchOptions = {
  token?: string | null;
  onUnauthorized?: () => void;
  signal?: AbortSignal;
};

export async function gatewayFetch<T = unknown>(
  baseUrl: string,
  path: string,
  { token, onUnauthorized, signal }: FetchOptions = {},
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, signal });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (res.status === 403) {
    throw new Error("권한이 없습니다.");
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}
