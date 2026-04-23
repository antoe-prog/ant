import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { authApi, type AuthUser } from "./api";

const TOKEN_KEY = "adminweb.auth.token";
const USER_KEY = "adminweb.auth.user";

type AuthState = {
  ready: boolean;
  user: AuthUser | null;
  token: string | null;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
};

const AuthCtx = createContext<AuthState | null>(null);

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const persist = useCallback((nextToken: string | null, nextUser: AuthUser | null) => {
    if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken);
    else localStorage.removeItem(TOKEN_KEY);
    if (nextUser) localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    else localStorage.removeItem(USER_KEY);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const res = await authApi.login(baseUrl, { email: email.trim().toLowerCase(), password });
      persist(res.token, res.user);
    },
    [baseUrl, persist],
  );

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      setError(null);
      const res = await authApi.register(baseUrl, {
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
      });
      persist(res.token, res.user);
    },
    [baseUrl, persist],
  );

  const logout = useCallback(async () => {
    const current = token;
    persist(null, null);
    if (current) {
      await authApi.logout(baseUrl, current);
    }
  }, [baseUrl, persist, token]);

  const refresh = useCallback(async () => {
    if (!token) {
      setReady(true);
      return;
    }
    try {
      const me = await authApi.me(baseUrl, token);
      persist(token, me);
    } catch {
      persist(null, null);
    } finally {
      setReady(true);
    }
  }, [baseUrl, persist, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      user,
      token,
      error,
      login,
      register,
      logout,
      refresh,
      clearError: () => setError(null),
    }),
    [ready, user, token, error, login, register, logout, refresh],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
