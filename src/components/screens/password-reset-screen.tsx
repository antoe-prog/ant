"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, Smartphone } from "lucide-react";
import { authInputLimits } from "@/lib/auth-input-policy";
import { ApiClientError, apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/primitives";
import { FinalWordmark } from "@/components/brand/final-wordmark";

type PasswordResetStep = "phone" | "code" | "password" | "complete";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}

export function PasswordResetScreen() {
  const [step, setStep] = useState<PasswordResetStep>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    if (!phone.trim()) {
      setError("휴대폰 번호를 입력해 주세요.");
      return;
    }

    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const result = await apiClient.requestPasswordResetCode(phone.trim());
      setCode(result.developmentCode ?? "");
      setMessage(
        result.developmentCode
          ? "개발용 인증번호를 입력란에 채웠습니다."
          : "등록된 번호인 경우 인증번호를 전송했습니다.",
      );
      setStep("code");
    } catch (requestError) {
      setError(errorMessage(requestError, "인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setPending(false);
    }
  }

  async function handlePhoneSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendCode();
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!/^\d{6}$/.test(code.trim())) {
      setError("6자리 인증번호를 입력해 주세요.");
      return;
    }

    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const result = await apiClient.verifyPasswordResetCode(phone.trim(), code.trim());
      setResetToken(result.resetToken);
      setCode("");
      setStep("password");
      setMessage("휴대폰 인증이 완료되었습니다.");
    } catch (verificationError) {
      setError(errorMessage(verificationError, "인증번호를 확인하지 못했습니다."));
    } finally {
      setPending(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 8) {
      setError("새 비밀번호는 8자리 이상 입력해 주세요.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("새 비밀번호가 서로 일치하지 않습니다.");
      return;
    }

    setPending(true);
    setError(null);
    setMessage(null);

    try {
      await apiClient.completePasswordReset(resetToken, password);
      setPassword("");
      setPasswordConfirm("");
      setResetToken("");
      setStep("complete");
    } catch (completionError) {
      setError(errorMessage(completionError, "비밀번호를 변경하지 못했습니다. 다시 인증해 주세요."));
    } finally {
      setPending(false);
    }
  }

  function restart() {
    setStep("phone");
    setCode("");
    setResetToken("");
    setPassword("");
    setPasswordConfirm("");
    setMessage(null);
    setError(null);
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
              {step === "complete" ? (
                <CheckCircle2 className="h-5 w-5" aria-hidden />
              ) : step === "phone" ? (
                <Smartphone className="h-5 w-5" aria-hidden />
              ) : (
                <KeyRound className="h-5 w-5" aria-hidden />
              )}
            </div>
            <div>
              <h1 className="text-xl font-semibold text-zinc-950">
                {step === "complete" ? "비밀번호 변경 완료" : "비밀번호 변경"}
              </h1>
              {step !== "complete" ? (
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  {step === "phone"
                    ? "가입할 때 등록한 휴대폰 번호로 본인 확인을 진행합니다."
                    : step === "code"
                      ? "문자로 받은 6자리 인증번호를 입력해 주세요."
                      : "새 비밀번호를 8자리 이상 입력해 주세요."}
                </p>
              ) : null}
            </div>
          </div>

          {step === "phone" ? (
            <form className="mt-5 grid gap-3" data-testid="password-reset-phone-form" onSubmit={(event) => void handlePhoneSubmit(event)}>
              <label>
                <span className="text-sm font-semibold text-zinc-700">휴대폰 번호</span>
                <input
                  autoComplete="tel"
                  className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="password-reset-phone-input"
                  inputMode="tel"
                  maxLength={authInputLimits.phoneLength}
                  placeholder="휴대폰 번호를 입력하세요"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </label>

              <Button className="w-full" disabled={pending} type="submit" variant="primary">
                {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
                인증번호 받기
              </Button>
            </form>
          ) : null}

          {step === "code" ? (
            <form className="mt-5 grid gap-3" data-testid="password-reset-code-form" onSubmit={(event) => void handleCodeSubmit(event)}>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                <p className="text-xs font-medium text-zinc-500">인증 휴대폰</p>
                <p className="mt-1 text-sm font-semibold text-zinc-800">{phone}</p>
              </div>
              <label>
                <span className="text-sm font-semibold text-zinc-700">인증번호</span>
                <input
                  autoComplete="one-time-code"
                  autoFocus
                  className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-center text-lg font-semibold tracking-[0.25em] outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="password-reset-code-input"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </label>

              <Button className="w-full" disabled={pending} type="submit" variant="primary">
                {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
                인증 확인
              </Button>
              <button
                className="min-h-11 text-sm font-semibold text-teal-700 hover:text-teal-800 disabled:text-zinc-400"
                disabled={pending}
                type="button"
                onClick={() => void sendCode()}
              >
                인증번호 다시 받기
              </button>
            </form>
          ) : null}

          {step === "password" ? (
            <form className="mt-5 grid gap-3" data-testid="password-reset-password-form" onSubmit={(event) => void handlePasswordSubmit(event)}>
              <label>
                <span className="text-sm font-semibold text-zinc-700">새 비밀번호</span>
                <div className="relative mt-2">
                  <input
                    autoComplete="new-password"
                    autoFocus
                    className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 pr-11 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                    data-testid="password-reset-password-input"
                    maxLength={authInputLimits.passwordLength}
                    minLength={8}
                    placeholder="8자리 이상 입력"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-zinc-500"
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
              </label>
              <label>
                <span className="text-sm font-semibold text-zinc-700">새 비밀번호 확인</span>
                <input
                  autoComplete="new-password"
                  className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="password-reset-password-confirm-input"
                  maxLength={authInputLimits.passwordLength}
                  minLength={8}
                  placeholder="새 비밀번호 다시 입력"
                  type={showPassword ? "text" : "password"}
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                />
              </label>

              <Button className="w-full" disabled={pending} type="submit" variant="primary">
                {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
                비밀번호 변경
              </Button>
            </form>
          ) : null}

          {step === "complete" ? (
            <div className="mt-5 grid gap-3">
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-medium leading-6 text-emerald-800" role="status">
                새 비밀번호로 변경했습니다. 기존 로그인은 종료되며 새 비밀번호로 다시 로그인해 주세요.
              </p>
              <Link
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-brand-teal-700 bg-brand-teal-700 px-3 text-sm font-semibold text-white transition hover:bg-brand-teal-800 active:scale-[0.98]"
                href="/login"
              >
                로그인하기
              </Link>
            </div>
          ) : null}

          {message && step !== "complete" ? (
            <p className="mt-3 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          {step === "code" || step === "password" ? (
            <button
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-zinc-600 hover:text-zinc-900"
              type="button"
              onClick={restart}
            >
              다른 휴대폰 번호로 인증
            </button>
          ) : null}

          {step !== "complete" ? (
            <Link className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal-700 hover:text-teal-800" href="/login">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              로그인으로 돌아가기
            </Link>
          ) : null}
        </section>
      </div>
    </main>
  );
}
