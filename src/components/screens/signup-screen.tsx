"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle, Smartphone } from "lucide-react";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/primitives";
import { FinalWordmark } from "@/components/brand/final-wordmark";

function normalizePhoneInput(value: string) {
  return value.replace(/[^\d]/g, "").slice(0, 11);
}

export function SignupScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const cleanName = name.trim();
    const cleanPhone = normalizePhoneInput(phone);

    if (!cleanName) {
      setError("이름을 입력해 주세요.");
      return;
    }

    if (!/^01\d{8,9}$/.test(cleanPhone)) {
      setError("휴대폰 번호를 확인해 주세요.");
      return;
    }

    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }

    if (password !== passwordConfirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setPending(true);

    try {
      await apiClient.registerWithPhone({ name: cleanName, password, phone: cleanPhone });
      router.replace(`/login?registered=1&phone=${encodeURIComponent(cleanPhone)}`);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "회원가입을 완료하지 못했습니다.");
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
              <Smartphone className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-zinc-950">휴대폰 번호로 회원가입</h1>
              <p className="mt-1 text-sm leading-5 text-zinc-600">본인 이름과 휴대폰 번호로 성인 회원 계정을 만듭니다.</p>
            </div>
          </div>

          <form className="mt-5 grid gap-3" data-testid="phone-signup-form" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              <span className="text-sm font-semibold text-zinc-700">이름</span>
              <input
                autoComplete="name"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="signup-name-input"
                placeholder="이름 입력"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>

            <label>
              <span className="text-sm font-semibold text-zinc-700">휴대폰 번호</span>
              <input
                autoComplete="tel"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="signup-phone-input"
                inputMode="tel"
                placeholder="휴대폰 번호 입력"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(normalizePhoneInput(event.target.value))}
                required
              />
            </label>

            <label>
              <span className="text-sm font-semibold text-zinc-700">비밀번호</span>
              <input
                autoComplete="new-password"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="signup-password-input"
                minLength={8}
                placeholder="8자 이상"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            <label>
              <span className="text-sm font-semibold text-zinc-700">비밀번호 확인</span>
              <input
                autoComplete="new-password"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="signup-password-confirm-input"
                minLength={8}
                placeholder="다시 입력"
                type="password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                required
              />
            </label>

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
                {error}
              </p>
            ) : null}

            <Button data-testid="signup-submit-button" className="w-full" disabled={pending} size="lg" type="submit" variant="primary">
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
              회원가입
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
