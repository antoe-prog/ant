import { useState, type FormEvent } from "react";

import { useAuth } from "./AuthContext";

type Mode = "login" | "register";

export default function LoginPage({ gatewayBase }: { gatewayBase: string }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setErr(null);

    if (!email.trim() || !password) {
      setErr("이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    if (mode === "register") {
      if (password.length < 8) {
        setErr("비밀번호는 8자 이상이어야 합니다.");
        return;
      }
      if (!name.trim()) {
        setErr("이름을 입력해 주세요.");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <p className="eyebrow">Admin Web</p>
          <h1>{mode === "login" ? "로그인" : "회원가입"}</h1>
          <p className="meta">이메일 + 비밀번호로 직접 가입하고 로그인합니다.</p>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => {
              setMode("login");
              setErr(null);
            }}
          >
            로그인
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={`auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => {
              setMode("register");
              setErr(null);
            }}
          >
            회원가입
          </button>
        </div>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {mode === "register" ? (
            <label className="auth-field">
              <span>이름</span>
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                disabled={submitting}
                required
              />
            </label>
          ) : null}

          <label className="auth-field">
            <span>이메일</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={submitting}
              required
            />
          </label>

          <label className="auth-field">
            <span>비밀번호</span>
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "8자 이상" : "비밀번호"}
              disabled={submitting}
              minLength={mode === "register" ? 8 : 1}
              required
            />
          </label>

          {err ? <p className="err" role="alert">{err}</p> : null}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting
              ? mode === "login"
                ? "로그인 중…"
                : "가입 중…"
              : mode === "login"
                ? "로그인"
                : "회원가입"}
          </button>
        </form>

        <p className="auth-hint">
          API: <code>{gatewayBase}</code>
          <br />
          첫 가입자는 자동으로 <strong>admin</strong> 역할이 부여됩니다.
        </p>
      </div>
    </div>
  );
}
