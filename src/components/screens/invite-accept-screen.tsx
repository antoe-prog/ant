"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useAppStore } from "@/store/app-store";
import { FinalWordmark } from "@/components/brand/final-wordmark";

export function InviteAcceptScreen({ token }: { token: string }) {
  const router = useRouter();
  const { acceptInvitation } = useAppStore();
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password.length < 12) {
      setError("비밀번호는 12자 이상이어야 합니다.");
      return;
    }

    if (password !== passwordConfirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setPending(true);
    setError(null);

    const result = await acceptInvitation(token, password);

    if (!result.ok) {
      setPending(false);
      setError(result.message);
      return;
    }

    router.replace("/app/dashboard");
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
              <UserCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-zinc-950">초대 가입</h1>
            </div>
          </div>

          <form className="mt-5 grid gap-3" onSubmit={(event) => void handleAccept(event)}>
            <label>
              <span className="text-sm font-semibold text-zinc-700">사용할 비밀번호</span>
              <input
                autoComplete="new-password"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                minLength={12}
                placeholder="12자 이상"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            <label>
              <span className="text-sm font-semibold text-zinc-700">비밀번호 확인</span>
              <input
                autoComplete="new-password"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                minLength={12}
                placeholder="다시 입력"
                type="password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
              />
            </label>

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
                {error}
              </p>
            ) : null}

            <Button className="w-full" disabled={pending} type="submit" variant="primary">
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
              비밀번호 설정 후 초대 수락
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
