import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { FinalWordmark } from "@/components/brand/final-wordmark";

type LegalPageShellProps = {
  children: ReactNode;
  description: string;
  title: string;
};

export function LegalPageShell({ children, description, title }: LegalPageShellProps) {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-950 sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="border-b border-zinc-200 pb-6">
          <FinalWordmark />
          <Link
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 hover:text-teal-800"
            href="/login"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            서비스로 돌아가기
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-zinc-950 sm:text-3xl">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 sm:text-base">{description}</p>
        </header>

        <div className="py-7 sm:py-10">{children}</div>

        <footer className="border-t border-zinc-200 py-6 text-sm text-zinc-500">
          <p>파이널 유도 멀티짐 · 운영자 조승권</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            <Link className="font-semibold text-teal-700 hover:text-teal-800" href="/privacy">
              개인정보처리방침
            </Link>
            <Link className="font-semibold text-teal-700 hover:text-teal-800" href="/account-deletion">
              계정 및 데이터 삭제
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}

export function LegalSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="border-b border-zinc-200 py-7 first:pt-0 last:border-b-0 last:pb-0">
      <h2 className="text-lg font-bold text-zinc-950 sm:text-xl">{title}</h2>
      <div className="mt-4 space-y-3 text-sm leading-6 text-zinc-700 sm:text-base sm:leading-7">{children}</div>
    </section>
  );
}
