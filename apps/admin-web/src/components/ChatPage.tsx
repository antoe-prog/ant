import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useAuth } from "../auth/AuthContext";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  meta?: string;
};

type ChatResponse = {
  provider: string;
  model: string;
  answer: string;
  request_id: string;
};

function randId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function ChatPage({ gatewayBase }: { gatewayBase: string }) {
  const { user, token, logout } = useAuth();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [model, setModel] = useState<string>("");
  const [temperature, setTemperature] = useState<number>(0.4);
  const logRef = useRef<HTMLDivElement>(null);

  const sessionId = useMemo(() => `web-${user?.id ?? "anon"}`, [user?.id]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      if (!token || !user) return;
      const userMsg: ChatMessage = { id: randId(), role: "user", text };
      setMessages((prev) => [...prev, userMsg]);
      setSending(true);
      setErr(null);
      try {
        const res = await fetch(`${gatewayBase.replace(/\/$/, "")}/v1/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            user_id: user.id,
            session_id: sessionId,
            message: text,
            model: model || undefined,
            temperature,
          }),
        });
        if (res.status === 401) {
          void logout();
          throw new Error("세션이 만료되었습니다.");
        }
        if (!res.ok) {
          let detail = `${res.status} ${res.statusText}`;
          try {
            const body = (await res.json()) as { detail?: unknown };
            if (typeof body?.detail === "string") detail = body.detail;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }
        const data = (await res.json()) as ChatResponse;
        const answer: ChatMessage = {
          id: data.request_id || randId(),
          role: "assistant",
          text: data.answer,
          meta: `${data.provider} · ${data.model}`,
        };
        setMessages((prev) => [...prev, answer]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
      }
    },
    [gatewayBase, token, user, sessionId, model, temperature, logout],
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    void send(text);
  };

  return (
    <section className="page chat-page">
      <div className="page-head">
        <h2>AI 대화</h2>
        <button
          type="button"
          onClick={() => {
            setMessages([]);
            setErr(null);
          }}
          disabled={sending}
        >
          기록 비우기
        </button>
      </div>

      <div className="chat-controls">
        <label className="auth-field">
          <span>모델 (비우면 기본값)</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            disabled={sending}
          />
        </label>
        <label className="auth-field">
          <span>temperature ({temperature.toFixed(2)})</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            disabled={sending}
          />
        </label>
      </div>

      <div className="chat-log" ref={logRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="meta chat-empty">질문을 입력하면 `/v1/chat` 게이트웨이로 전달됩니다.</p>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role}`}>
            <div className="chat-role">{m.role === "user" ? "나" : "AI"}</div>
            <div className="chat-text">{m.text}</div>
            {m.meta ? <div className="chat-meta">{m.meta}</div> : null}
          </div>
        ))}
        {sending ? <p className="meta chat-typing">답변 생성 중…</p> : null}
      </div>

      {err ? <p className="err">오류: {err}</p> : null}

      <form className="chat-input-row" onSubmit={onSubmit}>
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const text = input.trim();
              if (text && !sending) {
                setInput("");
                void send(text);
              }
            }
          }}
          placeholder="메시지 입력 (Shift+Enter 줄바꿈)"
          disabled={sending}
        />
        <button type="submit" className="auth-submit chat-send" disabled={sending || !input.trim()}>
          {sending ? "전송 중…" : "보내기"}
        </button>
      </form>
    </section>
  );
}
