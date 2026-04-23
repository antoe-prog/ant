import { useState, type FormEvent } from "react";

import { authApi } from "../auth/api";
import { useAuth } from "../auth/AuthContext";

export default function SettingsPage({ gatewayBase }: { gatewayBase: string }) {
  const { user, token } = useAuth();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const reset = () => {
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || !token) return;
    setMsg(null);

    if (newPw.length < 8) {
      setMsg({ kind: "err", text: "새 비밀번호는 8자 이상이어야 합니다." });
      return;
    }
    if (newPw !== confirmPw) {
      setMsg({ kind: "err", text: "새 비밀번호 확인이 일치하지 않습니다." });
      return;
    }
    if (newPw === currentPw) {
      setMsg({ kind: "err", text: "새 비밀번호는 현재 비밀번호와 달라야 합니다." });
      return;
    }

    setSubmitting(true);
    try {
      await authApi.changePassword(gatewayBase, token, {
        current_password: currentPw,
        new_password: newPw,
      });
      reset();
      setMsg({ kind: "ok", text: "비밀번호가 변경되었습니다." });
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="page">
      <div className="page-head">
        <h2>계정 설정</h2>
      </div>

      <div className="settings-card">
        <div className="settings-field-row">
          <span className="meta">이메일</span>
          <strong>{user?.email}</strong>
        </div>
        <div className="settings-field-row">
          <span className="meta">이름</span>
          <strong>{user?.name || "—"}</strong>
        </div>
        <div className="settings-field-row">
          <span className="meta">역할</span>
          <span className={`role-badge role-${user?.role}`}>{user?.role}</span>
        </div>
      </div>

      <h3 className="section-title">비밀번호 변경</h3>
      <form className="auth-form settings-form" onSubmit={onSubmit} noValidate>
        <label className="auth-field">
          <span>현재 비밀번호</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            disabled={submitting}
            required
          />
        </label>
        <label className="auth-field">
          <span>새 비밀번호</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="8자 이상"
            disabled={submitting}
            minLength={8}
            required
          />
        </label>
        <label className="auth-field">
          <span>새 비밀번호 확인</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            disabled={submitting}
            minLength={8}
            required
          />
        </label>

        {msg ? (
          <p className={msg.kind === "ok" ? "ok" : "err"} role="alert">
            {msg.text}
          </p>
        ) : null}

        <button type="submit" className="auth-submit" disabled={submitting}>
          {submitting ? "변경 중…" : "비밀번호 변경"}
        </button>
      </form>
    </section>
  );
}
