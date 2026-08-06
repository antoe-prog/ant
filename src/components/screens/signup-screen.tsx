"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, LoaderCircle, Smartphone } from "lucide-react";
import { authInputLimits } from "@/lib/auth-input-policy";
import { ApiClientError, apiClient, type PublicSignupBranch } from "@/lib/api-client";
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
  const [branches, setBranches] = useState<PublicSignupBranch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [branchesPending, setBranchesPending] = useState(true);
  const [branchLoadError, setBranchLoadError] = useState<string | null>(null);
  const [branchReloadKey, setBranchReloadKey] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void apiClient
      .getPublicSignupBranches()
      .then(({ branches: availableBranches }) => {
        if (!active) {
          return;
        }

        setBranches(availableBranches);
        setSelectedBranchId(availableBranches.length === 1 ? availableBranches[0].id : "");
      })
      .catch((caught) => {
        if (!active) {
          return;
        }

        setBranches([]);
        setSelectedBranchId("");
        setBranchLoadError(caught instanceof ApiClientError ? caught.message : "가입 지점을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) {
          setBranchesPending(false);
        }
      });

    return () => {
      active = false;
    };
  }, [branchReloadKey]);

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

    if (!selectedBranchId) {
      setError(branchesPending ? "가입 지점을 확인하고 있습니다." : "가입 지점을 선택해 주세요.");
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
      await apiClient.registerWithPhone({
        branchId: selectedBranchId,
        name: cleanName,
        password,
        phone: cleanPhone,
      });
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
              <p className="mt-1 text-sm leading-5 text-zinc-600">이름과 휴대폰 번호로 성인 회원 계정을 만듭니다.</p>
            </div>
          </div>

          <form className="mt-5 grid gap-3" data-testid="phone-signup-form" onSubmit={(event) => void handleSubmit(event)}>
            <label>
              <span className="text-sm font-semibold text-zinc-700">이름</span>
              <input
                autoComplete="name"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="signup-name-input"
                maxLength={authInputLimits.registrationNameLength}
                placeholder="이름 입력"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>

            <div>
              <label className="text-sm font-semibold text-zinc-700" htmlFor="signup-branch-input">
                가입 지점
              </label>
              {branchesPending ? (
                <div className="mt-2 flex h-11 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-600" role="status">
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  지점 확인 중
                </div>
              ) : branches.length > 1 ? (
                <select
                  className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-teal-500"
                  data-testid="signup-branch-input"
                  id="signup-branch-input"
                  value={selectedBranchId}
                  onChange={(event) => setSelectedBranchId(event.target.value)}
                  required
                >
                  <option value="">지점 선택</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} · {branch.district}
                    </option>
                  ))}
                </select>
              ) : branches.length === 1 ? (
                <div
                  className="mt-2 flex min-h-11 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-800"
                  data-testid="signup-branch-summary"
                  id="signup-branch-input"
                >
                  {branches[0].name} · {branches[0].district}
                </div>
              ) : null}

              {branchLoadError ? (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                  <span>{branchLoadError}</span>
                  <button
                    className="min-h-11 shrink-0 rounded-md px-3 font-semibold text-red-700 hover:bg-red-100"
                    type="button"
                    onClick={() => {
                      setBranchesPending(true);
                      setBranchLoadError(null);
                      setBranchReloadKey((current) => current + 1);
                    }}
                  >
                    다시 시도
                  </button>
                </div>
              ) : null}
            </div>

            <div>
              <label className="text-sm font-semibold text-zinc-700" htmlFor="signup-phone-input">
                휴대폰 번호
              </label>
              <input
                autoComplete="tel"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="signup-phone-input"
                id="signup-phone-input"
                inputMode="tel"
                maxLength={11}
                placeholder="휴대폰 번호 입력"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(normalizePhoneInput(event.target.value))}
                required
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-zinc-700" htmlFor="signup-password-input">
                비밀번호
              </label>
              <span className="relative mt-2 block">
                <input
                  autoComplete="new-password"
                  className="h-11 w-full rounded-md border border-zinc-200 bg-white px-3 pr-12 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                  data-testid="signup-password-input"
                  id="signup-password-input"
                  maxLength={authInputLimits.passwordLength}
                  minLength={8}
                  placeholder="8자 이상"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
                  aria-pressed={showPassword}
                  className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-800"
                  data-testid="signup-password-visibility-toggle"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </span>
            </div>

            <div>
              <label className="text-sm font-semibold text-zinc-700" htmlFor="signup-password-confirm-input">
                비밀번호 확인
              </label>
              <input
                autoComplete="new-password"
                className="mt-2 h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-teal-500"
                data-testid="signup-password-confirm-input"
                id="signup-password-confirm-input"
                maxLength={authInputLimits.passwordLength}
                minLength={8}
                placeholder="다시 입력"
                type={showPassword ? "text" : "password"}
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                required
              />
            </div>

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
                {error}
              </p>
            ) : null}

            <p className="text-xs leading-5 text-zinc-500">
              회원가입 전에{" "}
              <Link className="font-semibold text-teal-700 underline underline-offset-4" href="/privacy">
                개인정보처리방침
              </Link>
              을 확인해 주세요.
            </p>

            <Button
              data-testid="signup-submit-button"
              className="w-full"
              disabled={pending || branchesPending || branches.length === 0}
              size="lg"
              type="submit"
              variant="primary"
            >
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
