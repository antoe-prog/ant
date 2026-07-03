import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-teal-700">404</p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-950">화면을 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">요청한 경로가 없거나 현재 사용할 수 없는 화면입니다.</p>
        <Link
          className="mt-5 inline-flex h-10 items-center rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
          href="/app/dashboard"
        >
          대시보드로 이동
        </Link>
      </div>
    </div>
  );
}
