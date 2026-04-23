export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member" | string;
};

export type AuthResponse = {
  token: string;
  user: AuthUser;
};

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) {
      const first = body.detail[0] as { msg?: string } | undefined;
      if (first?.msg) return first.msg;
    }
  } catch {
    /* ignore */
  }
  return `${res.status} ${res.statusText}`;
}

async function postJson<T>(baseUrl: string, path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await parseError(res);
    throw new Error(mapAuthError(detail));
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

async function getJson<T>(baseUrl: string, path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, { headers });
  if (!res.ok) {
    const detail = await parseError(res);
    throw new Error(mapAuthError(detail));
  }
  return (await res.json()) as T;
}

function mapAuthError(detail: string): string {
  switch (detail) {
    case "email_taken":
      return "이미 가입된 이메일입니다.";
    case "invalid_credentials":
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    case "invalid_email":
      return "이메일 형식이 올바르지 않습니다.";
    case "missing_token":
    case "invalid_token":
    case "user_not_found":
      return "세션이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.";
    case "invalid_current_password":
      return "현재 비밀번호가 올바르지 않습니다.";
    case "same_password":
      return "새 비밀번호는 기존 비밀번호와 달라야 합니다.";
    case "forbidden_role":
    case "forbidden_other_user":
      return "권한이 없습니다.";
    default:
      return detail;
  }
}

export const authApi = {
  register: (baseUrl: string, input: { email: string; password: string; name: string }) =>
    postJson<AuthResponse>(baseUrl, "/v1/auth/register", input),
  login: (baseUrl: string, input: { email: string; password: string }) =>
    postJson<AuthResponse>(baseUrl, "/v1/auth/login", input),
  me: (baseUrl: string, token: string) => getJson<AuthUser>(baseUrl, "/v1/auth/me", token),
  changePassword: (
    baseUrl: string,
    token: string,
    input: { current_password: string; new_password: string },
  ) => postJson<void>(baseUrl, "/v1/auth/password", input, token),
  logout: (baseUrl: string, token?: string) =>
    postJson<void>(baseUrl, "/v1/auth/logout", {}, token).catch(() => void 0),
};
