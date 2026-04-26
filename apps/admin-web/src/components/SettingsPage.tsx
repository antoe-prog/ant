import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { authApi } from "../auth/api";
import { useAuth } from "../auth/AuthContext";
import { readDojoApiBase, readDojoToken, writeDojoApiBase, writeDojoToken } from "../dojoClient";

type SettingsPageProps = {
  gatewayBase: string;
  dojoApiBase: string;
  onDojoApiBaseChange: (value: string) => void;
  dojoConnected: boolean;
};

export default function SettingsPage({
  gatewayBase,
  dojoApiBase,
  onDojoApiBaseChange,
  dojoConnected,
}: SettingsPageProps) {
  const { user, token } = useAuth();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [localDojoApiBase, setLocalDojoApiBase] = useState(dojoApiBase);
  const [showToken, setShowToken] = useState(false);
  const [workingToken, setWorkingToken] = useState(readDojoToken());
  const [tokenDraft, setTokenDraft] = useState("");
  const [checkingGateway, setCheckingGateway] = useState(false);
  const [gatewayCheckMsg, setGatewayCheckMsg] = useState<string | null>(null);
  const [checkingDojo, setCheckingDojo] = useState(false);
  const [dojoCheckMsg, setDojoCheckMsg] = useState<string | null>(null);
  const [tokenMsg, setTokenMsg] = useState<string | null>(null);
  const [baseSavedMsg, setBaseSavedMsg] = useState<string | null>(null);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedGatewayBase = useMemo(() => gatewayBase.trim().replace(/\/+$/, ""), [gatewayBase]);
  const normalizedDojoBase = useMemo(() => localDojoApiBase.trim().replace(/\/+$/, ""), [localDojoApiBase]);
  const maskedToken = useMemo(() => {
    if (!workingToken) return "(없음)";
    if (showToken) return workingToken;
    if (workingToken.length <= 12) return `${workingToken.slice(0, 4)}...${workingToken.slice(-2)}`;
    return `${workingToken.slice(0, 8)}...${workingToken.slice(-6)}`;
  }, [showToken, workingToken]);

  const reset = () => {
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
  };

  const passwordStrength = useMemo(() => {
    const score =
      (newPw.length >= 8 ? 1 : 0) +
      (/[A-Z]/.test(newPw) ? 1 : 0) +
      (/[a-z]/.test(newPw) ? 1 : 0) +
      (/\d/.test(newPw) ? 1 : 0) +
      (/[^A-Za-z0-9]/.test(newPw) ? 1 : 0);
    if (!newPw) return "미입력";
    if (score <= 2) return "약함";
    if (score <= 4) return "보통";
    return "강함";
  }, [newPw]);
  const passwordChecks = useMemo(
    () => ({
      len: newPw.length >= 8,
      upper: /[A-Z]/.test(newPw),
      lower: /[a-z]/.test(newPw),
      digit: /\d/.test(newPw),
      special: /[^A-Za-z0-9]/.test(newPw),
    }),
    [newPw],
  );
  const canSubmitPw = useMemo(
    () =>
      Boolean(currentPw) &&
      Boolean(newPw) &&
      Boolean(confirmPw) &&
      newPw === confirmPw &&
      newPw !== currentPw &&
      newPw.length >= 8,
    [confirmPw, currentPw, newPw],
  );

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
  useEffect(() => {
    if (!showToken) return;
    const id = window.setTimeout(() => setShowToken(false), 15000);
    return () => window.clearTimeout(id);
  }, [showToken]);

  return (
    <section className="page">
      <div className="page-head">
        <h2>계정 설정</h2>
      </div>

      <div className="settings-card">
        <div className="settings-field-row">
          <span className="meta">게이트웨이 API</span>
          <code>{gatewayBase}</code>
        </div>
        <div className="settings-field-row">
          <span className="meta">도장 API 상태</span>
          <strong>{dojoConnected ? "연결됨" : "미연결"}</strong>
        </div>
        <div className="settings-form">
          <label className="auth-field">
            <span>도장 API Base URL</span>
            <input
              value={localDojoApiBase}
              onChange={(e) => setLocalDojoApiBase(e.target.value)}
              placeholder="http://127.0.0.1:3000"
            />
          </label>
          <div className="row-actions-inline">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                const v = normalizedDojoBase;
                writeDojoApiBase(v);
                onDojoApiBaseChange(v);
                setBaseSavedMsg("도장 API Base URL을 저장했습니다.");
              }}
            >
              URL 저장
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                const saved = readDojoApiBase();
                setLocalDojoApiBase(saved);
                onDojoApiBaseChange(saved);
                setBaseSavedMsg("저장된 URL을 다시 불러왔습니다.");
              }}
            >
              저장값 재불러오기
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                const v = normalizedDojoBase;
                setLocalDojoApiBase(v);
                onDojoApiBaseChange(v);
                setBaseSavedMsg("URL 끝의 슬래시를 정리했습니다.");
              }}
            >
              URL 정규화
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setLocalDojoApiBase("http://127.0.0.1:3000");
                onDojoApiBaseChange("http://127.0.0.1:3000");
              }}
            >
              127.0.0.1 프리셋
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setLocalDojoApiBase("http://localhost:3000");
                onDojoApiBaseChange("http://localhost:3000");
              }}
            >
              localhost 프리셋
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setLocalDojoApiBase("https://api.judokan.store");
                onDojoApiBaseChange("https://api.judokan.store");
                setBaseSavedMsg("프로덕션 도장 API(api.judokan.store)로 설정했습니다.");
              }}
            >
              api.judokan.store
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                const host = window.location.hostname || "127.0.0.1";
                const lanPreset = `http://${host}:3000`;
                setLocalDojoApiBase(lanPreset);
                onDojoApiBaseChange(lanPreset);
                setBaseSavedMsg("현재 접속 호스트 기준 LAN 프리셋을 적용했습니다.");
              }}
            >
              현재 호스트 프리셋
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setLocalDojoApiBase(dojoApiBase);
                onDojoApiBaseChange(dojoApiBase);
                setBaseSavedMsg("현재 적용값으로 복원했습니다.");
              }}
            >
              현재 적용값 복원
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(normalizedGatewayBase);
                } catch {
                  // ignore clipboard error
                }
              }}
            >
              게이트웨이 URL 복사
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(normalizedDojoBase);
                } catch {
                  // ignore clipboard error
                }
              }}
            >
              도장 URL 복사
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={checkingGateway}
              onClick={async () => {
                setCheckingGateway(true);
                setGatewayCheckMsg(null);
                try {
                  const ctl = new AbortController();
                  const t = window.setTimeout(() => ctl.abort(), 5000);
                  const started = Date.now();
                  const res = await fetch(`${normalizedGatewayBase}/health`, { signal: ctl.signal });
                  window.clearTimeout(t);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  setGatewayCheckMsg(`게이트웨이 연결 확인 성공 (${Date.now() - started}ms)`);
                } catch (e) {
                  setGatewayCheckMsg(`게이트웨이 연결 실패: ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setCheckingGateway(false);
                }
              }}
            >
              {checkingGateway ? "연결 확인 중..." : "게이트웨이 연결 확인"}
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={checkingDojo}
              onClick={async () => {
                setCheckingDojo(true);
                setDojoCheckMsg(null);
                try {
                  const ctl = new AbortController();
                  const t = window.setTimeout(() => ctl.abort(), 5000);
                  const started = Date.now();
                  const res = await fetch(`${normalizedDojoBase}/health`, { signal: ctl.signal });
                  window.clearTimeout(t);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  setDojoCheckMsg(`도장 API 연결 확인 성공 (${Date.now() - started}ms)`);
                } catch (e) {
                  setDojoCheckMsg(`도장 API 연결 실패: ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setCheckingDojo(false);
                }
              }}
            >
              {checkingDojo ? "도장 확인 중..." : "도장 API 연결 확인"}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => window.open(`${normalizedDojoBase}/health`, "_blank")}
            >
              도장 헬스 열기
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => window.open(`${normalizedGatewayBase}/health`, "_blank")}
            >
              게이트웨이 헬스 열기
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={async () => {
                const payload = JSON.stringify(
                  { gateway: normalizedGatewayBase, dojo: normalizedDojoBase },
                  null,
                  2,
                );
                try {
                  await navigator.clipboard.writeText(payload);
                  setSettingsMsg("게이트웨이/도장 URL 묶음을 클립보드에 복사했습니다.");
                } catch {
                  setSettingsMsg("URL 묶음 복사에 실패했습니다.");
                }
              }}
            >
              URL 묶음 복사(JSON)
            </button>
          </div>
          {baseSavedMsg ? <p className="ok">{baseSavedMsg}</p> : null}
          {gatewayCheckMsg ? <p className="meta">{gatewayCheckMsg}</p> : null}
          {dojoCheckMsg ? <p className="meta">{dojoCheckMsg}</p> : null}
          {settingsMsg ? <p className="meta">{settingsMsg}</p> : null}
        </div>
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
        <div className="settings-field-row">
          <span className="meta">도장 세션 토큰</span>
          <code>{maskedToken}</code>
        </div>
        <div className="row-actions-inline">
          <button type="button" className="secondary-btn" onClick={() => setShowToken((v) => !v)}>
            {showToken ? "토큰 숨기기" : "토큰 보기(15초)"}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(workingToken);
              } catch {
                // ignore clipboard error
              }
            }}
            disabled={!workingToken}
          >
            토큰 복사
          </button>
          <button
            type="button"
            className="danger-btn"
            onClick={() => {
              writeDojoToken("");
              setWorkingToken("");
            }}
            disabled={!workingToken}
          >
            토큰 비우기
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setWorkingToken(readDojoToken())}
          >
            토큰 재조회
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setTokenDraft(workingToken)}
            disabled={!workingToken}
          >
            현재 토큰을 입력칸으로
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={async () => {
              try {
                const fromClipboard = await navigator.clipboard.readText();
                if (fromClipboard.trim()) {
                  setTokenDraft(fromClipboard.trim());
                }
              } catch {
                // ignore clipboard error
              }
            }}
          >
            클립보드에서 토큰 붙여넣기
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              const payload = {
                gatewayBase: normalizedGatewayBase,
                dojoApiBase: normalizedDojoBase,
                hasToken: Boolean(workingToken),
                tokenLength: workingToken.length,
                tokenPreview: workingToken ? `${workingToken.slice(0, 6)}...` : "",
                role: user?.role ?? "",
                exportedAt: new Date().toISOString(),
              };
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "admin-web-settings-export.json";
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
            }}
          >
            설정 내보내기(JSON)
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => importInputRef.current?.click()}
          >
            설정 가져오기(JSON)
          </button>
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const raw = await f.text();
              const parsed = JSON.parse(raw) as {
                dojoApiBase?: string;
                token?: string;
              };
              if (typeof parsed.dojoApiBase === "string" && parsed.dojoApiBase.trim()) {
                const v = parsed.dojoApiBase.trim();
                setLocalDojoApiBase(v);
                onDojoApiBaseChange(v);
                writeDojoApiBase(v);
              }
              if (typeof parsed.token === "string") {
                setTokenDraft(parsed.token);
              }
              setSettingsMsg("설정 JSON을 불러왔습니다. 필요한 항목을 저장/적용하세요.");
            } catch (err) {
              setSettingsMsg(`설정 파일 파싱 실패: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
              e.currentTarget.value = "";
            }
          }}
        />
        <label className="auth-field">
          <span>도장 세션 토큰 직접 입력</span>
          <input
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            placeholder="app_session_id 토큰"
          />
        </label>
        <div className="settings-field-row">
          <span className="meta">토큰 길이</span>
          <strong>{workingToken.length}자</strong>
        </div>
        <div className="row-actions-inline">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              const t = tokenDraft.trim();
              if (t && t.length < 20) {
                setTokenMsg("토큰 길이가 너무 짧습니다. 값이 맞는지 확인하세요.");
                return;
              }
              writeDojoToken(t);
              setWorkingToken(t);
              setTokenDraft("");
              setTokenMsg(t ? "토큰을 저장했습니다." : "토큰을 비웠습니다.");
            }}
            disabled={!tokenDraft.trim()}
          >
            토큰 저장/적용
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setTokenDraft("")}
            disabled={!tokenDraft}
          >
            입력칸 비우기
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              localStorage.setItem("adminweb.tokenDraft", tokenDraft);
              setTokenMsg("토큰 입력값을 임시 저장했습니다.");
            }}
            disabled={!tokenDraft}
          >
            입력값 임시저장
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              const saved = localStorage.getItem("adminweb.tokenDraft") || "";
              setTokenDraft(saved);
              setTokenMsg(saved ? "임시 저장 토큰을 불러왔습니다." : "저장된 임시 토큰이 없습니다.");
            }}
          >
            임시저장 불러오기
          </button>
        </div>
        {tokenMsg ? <p className="meta">{tokenMsg}</p> : null}
      </div>

      <h3 className="section-title">비밀번호 변경</h3>
      <form className="auth-form settings-form" onSubmit={onSubmit} noValidate>
        <label className="auth-field">
          <span>현재 비밀번호</span>
          <div className="row-actions-inline">
            <button type="button" className="secondary-btn" onClick={() => setShowCurrentPw((v) => !v)}>
              {showCurrentPw ? "숨기기" : "보기"}
            </button>
          </div>
          <input
            type={showCurrentPw ? "text" : "password"}
            autoComplete="current-password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            disabled={submitting}
            required
          />
        </label>
        <label className="auth-field">
          <span>새 비밀번호</span>
          <div className="row-actions-inline">
            <button type="button" className="secondary-btn" onClick={() => setShowNewPw((v) => !v)}>
              {showNewPw ? "숨기기" : "보기"}
            </button>
          </div>
          <input
            type={showNewPw ? "text" : "password"}
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
          <div className="row-actions-inline">
            <button type="button" className="secondary-btn" onClick={() => setShowConfirmPw((v) => !v)}>
              {showConfirmPw ? "숨기기" : "보기"}
            </button>
          </div>
          <input
            type={showConfirmPw ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            disabled={submitting}
            minLength={8}
            required
          />
        </label>
        <p className="meta">비밀번호 강도: {passwordStrength}</p>
        <div className="settings-field-row">
          <span className="meta">정책 체크</span>
          <span>
            {passwordChecks.len ? "8자 이상 OK" : "8자 이상 필요"} /{" "}
            {passwordChecks.upper ? "대문자 OK" : "대문자 필요"} /{" "}
            {passwordChecks.lower ? "소문자 OK" : "소문자 필요"} /{" "}
            {passwordChecks.digit ? "숫자 OK" : "숫자 필요"} /{" "}
            {passwordChecks.special ? "특수문자 OK" : "특수문자 필요"}
          </span>
        </div>
        {newPw && confirmPw && newPw !== confirmPw ? (
          <p className="err">새 비밀번호와 확인 값이 아직 일치하지 않습니다.</p>
        ) : null}
        {newPw && currentPw && newPw === currentPw ? (
          <p className="err">현재 비밀번호와 새 비밀번호가 같습니다.</p>
        ) : null}
        <div className="row-actions-inline">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              const random = `${Math.random().toString(36).slice(2, 8)}!${Date.now().toString(36).slice(-4)}A1`;
              setNewPw(random);
              setConfirmPw(random);
            }}
          >
            임시 비밀번호 생성
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={async () => {
              if (!newPw) return;
              try {
                await navigator.clipboard.writeText(newPw);
              } catch {
                // ignore clipboard error
              }
            }}
            disabled={!newPw}
          >
            새 비밀번호 복사
          </button>
          <button type="button" className="secondary-btn" onClick={reset}>
            입력값 초기화
          </button>
        </div>

        {msg ? (
          <p className={msg.kind === "ok" ? "ok" : "err"} role="alert">
            {msg.text}
          </p>
        ) : null}

        <button type="submit" className="auth-submit" disabled={submitting || !canSubmitPw}>
          {submitting ? "변경 중…" : "비밀번호 변경"}
        </button>
      </form>
    </section>
  );
}
