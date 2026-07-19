"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, LoaderCircle } from "lucide-react";
import { authInputLimits } from "@/lib/auth-input-policy";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/primitives";
import { FinalWordmark } from "@/components/brand/final-wordmark";

export function PasswordResetScreen() {
  const [identifier, setIdentifier] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!identifier.trim()) {
      setMessage("휴대폰 번호 또는 사용자 이름을 입력해 주세요.");
      return;
    }

    setPending(true);
    setMessage(null);

    try {
      await apiClient.requestPasswordReset(identifier.trim());
      setMessage("비밀번호 재설정 요청을 접수했습니다. 안내를 받은 뒤 다시 로그인해 주세요.");
      setIdentifier("");
    } catch {
      setMessage("재설정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-start gap-5 pt-6 sm:pt-10">
        <div>
          <FinalWordmark />
        </div>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
              <KeyRound className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-zinc-950">비밀번호 재설정</h1>
            </div>
          </div>

          <form className="mt-5 grid gap-3" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              <span className="text-sm font-semibold text-zinc-700">휴대폰 번호 또는 사용자 이름</span>
              <input
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                inputMode="tel"
                maxLength={authInputLimits.identifierLength}
                placeholder="휴대폰 번호 또는 사용자 이름 입력"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </label>

            {message ? (
              <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-700" role="status">
                {message}
              </p>
            ) : null}

            <Button className="w-full" disabled={pending} type="submit" variant="primary">
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
              재설정 요청
            </Button>
          </form>

          <Link className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-teal-700 hover:text-teal-800" href="/login">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            로그인으로 돌아가기
          </Link>
        </section>
      </div>
    </main>
  );
}
