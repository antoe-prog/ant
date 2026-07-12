"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { type KeyboardEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, CreditCard, LayoutGrid, Search, SearchX, UserRound, Users, X } from "lucide-react";
import type { AppUser, MockDatabase } from "@/lib/domain";
import { buildGlobalSearchResults, type GlobalSearchKind } from "@/lib/global-search";

const searchKindLabels: Record<GlobalSearchKind, string> = {
  menu: "메뉴",
  user: "사용자",
  member: "회원",
  payment: "결제",
  notice: "공지",
};

const searchKindIcons = {
  menu: LayoutGrid,
  user: UserRound,
  member: Users,
  payment: CreditCard,
  notice: Bell,
} satisfies Record<GlobalSearchKind, React.ComponentType<{ className?: string }>>;

const searchKindOrder: GlobalSearchKind[] = ["menu", "user", "member", "payment", "notice"];

type GlobalSearchProps = {
  db: MockDatabase;
  selectedBranchId: string | null;
  user: AppUser;
};

export function GlobalSearch({ db, selectedBranchId, user }: GlobalSearchProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultListRef = useRef<HTMLDivElement | null>(null);
  const results = useMemo(
    () => buildGlobalSearchResults({ db, query: deferredQuery, selectedBranchId, user }),
    [db, deferredQuery, selectedBranchId, user],
  );
  const resultSections = searchKindOrder.flatMap((kind) => {
    const items = results.filter((result) => result.kind === kind);

    return items.length > 0 ? [{ items, kind }] : [];
  });

  const closeSearch = useCallback((restoreFocus = true) => {
    setOpen(false);
    setQuery("");

    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    function handleGlobalShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        return;
      }

      if (event.key === "Escape" && open) {
        event.preventDefault();
        closeSearch();
      }
    }

    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, [closeSearch, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function moveToFirstResult() {
    resultListRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveToFirstResult();
      return;
    }

    if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      const href = results[0].href;
      closeSearch(false);
      router.push(href);
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = focusableElements[0];
    const last = focusableElements.at(-1);

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  const dialog = open ? (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-zinc-950/45 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-sm sm:px-6 sm:pt-20"
      data-testid="global-search-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeSearch();
        }
      }}
    >
      <div
        aria-label="통합 검색"
        aria-modal="true"
        className="flex max-h-[min(44rem,calc(100dvh-env(safe-area-inset-top)-1.5rem))] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl"
        data-testid="global-search-dialog"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-zinc-200 px-3 py-2 sm:px-4">
          <Search className="h-5 w-5 text-teal-700" aria-hidden />
          <input
            aria-label="사용자, 회원, 결제, 공지, 메뉴 검색"
            autoComplete="off"
            autoFocus
            className="h-12 min-w-0 border-0 bg-transparent px-1 text-base font-medium text-zinc-950 outline-none placeholder:text-zinc-400"
            data-testid="global-search-input"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="사용자, 회원, 결제, 공지, 메뉴 검색"
            ref={inputRef}
            type="search"
            value={query}
          />
          <button
            aria-label="통합 검색 닫기"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
            data-testid="global-search-close"
            onClick={() => closeSearch()}
            type="button"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-3" ref={resultListRef}>
          {resultSections.length > 0 ? (
            <div className="space-y-3" data-testid="global-search-results">
              {resultSections.map((section) => (
                <section aria-labelledby={`global-search-${section.kind}`} key={section.kind}>
                  <h2
                    className="px-2 pb-1 text-xs font-semibold text-zinc-500"
                    id={`global-search-${section.kind}`}
                  >
                    {searchKindLabels[section.kind]}
                  </h2>
                  <div className="divide-y divide-zinc-100">
                    {section.items.map((result) => {
                      const Icon = searchKindIcons[result.kind];

                      return (
                        <Link
                          className="group grid min-h-16 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 transition hover:bg-teal-50 focus:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500"
                          data-global-search-result="true"
                          href={result.href}
                          key={result.id}
                          onNavigate={() => closeSearch(false)}
                          prefetch={false}
                        >
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-700 transition group-hover:border-teal-200 group-hover:bg-white group-hover:text-teal-700">
                            <Icon className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-zinc-950">{result.title}</span>
                            <span className="mt-0.5 block truncate text-xs font-medium text-zinc-500">
                              {result.description}
                            </span>
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-teal-700" aria-hidden />
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center px-4 text-center" data-testid="global-search-empty">
              <SearchX className="h-7 w-7 text-zinc-400" aria-hidden />
              <p className="mt-3 text-sm font-semibold text-zinc-950">검색 결과가 없습니다</p>
              <p className="mt-1 text-sm text-zinc-500">이름, 연락처 또는 제목을 다시 확인해 주세요.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="통합 검색 열기"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-0 text-sm font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950 xl:w-64 xl:justify-start xl:px-3"
        data-testid="global-search-trigger"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden truncate xl:block">사용자·회원·결제·공지 검색</span>
      </button>
      {typeof document !== "undefined" && dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
