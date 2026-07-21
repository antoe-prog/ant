"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { Camera, CheckCircle2, QrCode, RefreshCw, ScanLine, X } from "lucide-react";
import QRCode from "qrcode";
import { isAttendanceQrWindowOpen } from "@/lib/attendance-qr-policy";
import { ApiClientError, apiClient, type AttendanceQrIssuePayload, type AttendanceQrScanResult } from "@/lib/api-client";
import type { ClassSession, Member } from "@/lib/domain";
import { formatCompactTimeRange } from "@/lib/format";
import { useAppStore } from "@/store/app-store";

function formatRemainingTime(expiresAt: string, now: number) {
  const remainingSeconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1_000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function stopVideo(video: HTMLVideoElement | null, controls: IScannerControls | null) {
  controls?.stop();
  const stream = video?.srcObject;

  if (stream instanceof MediaStream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  if (video) {
    video.srcObject = null;
  }
}

export function MemberAttendanceQrScannerCard({ member }: { member: Member }) {
  const { scanAttendanceQr } = useAppStore();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerRunId, setScannerRunId] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<AttendanceQrScanResult | null>(null);
  const [cameraStarting, setCameraStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const processingRef = useRef(false);

  const closeScanner = useCallback(() => {
    stopVideo(videoRef.current, controlsRef.current);
    controlsRef.current = null;
    processingRef.current = false;
    setScannerOpen(false);
    setCameraStarting(false);
  }, []);

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) {
      return;
    }

    let disposed = false;
    const video = videoRef.current;
    setCameraStarting(true);
    setCameraError(null);
    setScanResult(null);
    processingRef.current = false;

    async function startScanner() {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
        const controls = await reader.decodeFromVideoDevice(undefined, video, (result, _error, scannerControls) => {
          if (!result || processingRef.current || disposed) {
            return;
          }

          processingRef.current = true;
          scannerControls.stop();

          void scanAttendanceQr(member.id, result.getText()).then((outcome) => {
            if (disposed) {
              return;
            }

            if (outcome.ok) {
              setScanResult(outcome.scan);
              setCameraError(null);
              return;
            }

            setCameraError(outcome.message);
          });
        });

        if (disposed) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setCameraStarting(false);
      } catch (error) {
        if (disposed) {
          return;
        }

        setCameraStarting(false);
        setCameraError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "카메라 권한이 필요합니다. 기기 설정에서 카메라를 허용해 주세요."
            : "카메라를 열지 못했습니다. 다른 앱이 카메라를 사용 중인지 확인해 주세요.",
        );
      }
    }

    void startScanner();

    return () => {
      disposed = true;
      stopVideo(video, controlsRef.current);
      controlsRef.current = null;
    };
  }, [member.id, scanAttendanceQr, scannerOpen, scannerRunId]);

  function retryScanner() {
    stopVideo(videoRef.current, controlsRef.current);
    controlsRef.current = null;
    processingRef.current = false;
    setCameraError(null);
    setScanResult(null);
    setScannerRunId((value) => value + 1);
  }

  return (
    <>
      <section
        className="mx-auto w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-6"
        data-testid="member-attendance-qr-card"
      >
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
            <ScanLine className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-zinc-950">수업 QR 스캔</h1>
            <p className="mt-1 text-sm leading-6 text-zinc-600">코치 화면의 QR을 스캔하면 본인 출석이 바로 기록됩니다.</p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-5 text-center">
          <p className="font-semibold text-zinc-950">{member.name}</p>
          <p className="mt-1 text-sm leading-6 text-zinc-600">수업 장소에서 코치가 띄운 QR만 스캔해 주세요.</p>
          <button
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
            data-testid="member-attendance-qr-open"
            onClick={() => {
              setCameraError(null);
              setScanResult(null);
              setScannerOpen(true);
            }}
            type="button"
          >
            <Camera className="h-4 w-4" aria-hidden />
            QR 스캔하기
          </button>
        </div>

        <p className="mt-4 border-t border-zinc-100 pt-4 text-xs leading-5 text-zinc-500">
          다른 회원의 출석은 처리할 수 없으며, 등록된 수업과 출석 가능 시간을 서버에서 확인합니다.
        </p>
      </section>

      {scannerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="presentation">
          <section
            aria-labelledby="member-qr-scanner-title"
            aria-modal="true"
            className="max-h-[92dvh] w-full overflow-y-auto rounded-t-lg bg-white p-4 shadow-xl sm:max-w-lg sm:rounded-lg sm:p-5"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-zinc-950" id="member-qr-scanner-title">수업 QR 스캔</h2>
                <p className="mt-1 text-sm text-zinc-600">{member.name} 회원 본인 출석</p>
              </div>
              <button
                aria-label="QR 스캐너 닫기"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                onClick={closeScanner}
                type="button"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="relative mt-4 aspect-[4/3] overflow-hidden rounded-lg bg-zinc-950">
              <video className="h-full w-full object-cover" muted playsInline ref={videoRef} />
              {!scanResult && !cameraError ? (
                <div className="pointer-events-none absolute inset-[12%] rounded-lg border-2 border-white/90" aria-hidden />
              ) : null}
              {cameraStarting ? (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 text-sm font-semibold text-white" role="status">
                  카메라를 여는 중입니다
                </div>
              ) : null}
              {scanResult ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-950/90 p-6 text-center text-white" role="status">
                  <CheckCircle2 className="h-12 w-12" aria-hidden />
                  <p className="mt-3 text-xl font-bold">{scanResult.className}</p>
                  <p className="mt-1 text-sm text-emerald-100">
                    {scanResult.alreadyRecorded ? "이미 출석 처리된 수업입니다." : "출석 처리되었습니다."}
                  </p>
                </div>
              ) : null}
              {cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 p-6 text-center text-white" role="alert">
                  <p className="text-sm font-semibold leading-6">{cameraError}</p>
                  <button
                    className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-zinc-950"
                    onClick={retryScanner}
                    type="button"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    다시 스캔
                  </button>
                </div>
              ) : null}
            </div>

            <p className="mt-4 text-sm text-zinc-600">사각형 안에 코치 화면의 QR이 들어오도록 맞춰 주세요.</p>
            {scanResult ? (
              <button
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white"
                onClick={closeScanner}
                type="button"
              >
                확인
              </button>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

export function CoachAttendanceQrCard({
  sessions,
  currentTime,
  selectedBranchId,
}: {
  sessions: ClassSession[];
  currentTime: number;
  selectedBranchId: string | null;
}) {
  const eligibleSessions = useMemo(
    () => sessions.filter((session) => isAttendanceQrWindowOpen(session, new Date(currentTime))),
    [currentTime, sessions],
  );
  const [preferredSessionId, setPreferredSessionId] = useState(eligibleSessions[0]?.id ?? "");
  const [issued, setIssued] = useState<AttendanceQrIssuePayload | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const requestIdRef = useRef(0);
  const selectedSessionId = eligibleSessions.some((session) => session.id === preferredSessionId)
    ? preferredSessionId
    : eligibleSessions[0]?.id ?? "";
  const selectedSession = eligibleSessions.find((session) => session.id === selectedSessionId) ?? null;

  const issueQr = useCallback(async () => {
    if (!selectedSessionId) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);

    try {
      const nextIssued = await apiClient.createAttendanceQr(selectedSessionId, selectedBranchId);
      const image = await QRCode.toDataURL(nextIssued.payload, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 420,
        color: {
          dark: "#09090b",
          light: "#ffffff",
        },
      });

      if (requestId !== requestIdRef.current) {
        return;
      }

      setIssued(nextIssued);
      setQrImage(image);
      setNow(Date.now());
      setQrOpen(true);
    } catch (issueError) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setIssued(null);
      setQrImage(null);
      setError(issueError instanceof ApiClientError ? issueError.message : "수업 QR을 만들지 못했습니다.");
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [selectedBranchId, selectedSessionId]);

  useEffect(() => {
    if (!issued) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [issued]);

  const expired = !issued || Date.parse(issued.expiresAt) <= now;

  return (
    <>
      <section className="mt-4 rounded-lg border border-teal-200 bg-white p-4" data-testid="coach-attendance-qr-card">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
            <QrCode className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold text-zinc-950">수업 출석 QR</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">수업 QR을 띄워두면 등록 회원이 직접 스캔해 출석합니다.</p>
          </div>
        </div>

        {eligibleSessions.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block min-w-0 text-sm font-semibold text-zinc-800">
              출석 수업
              <select
                className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                onChange={(event) => {
                  requestIdRef.current += 1;
                  setPreferredSessionId(event.target.value);
                  setIssued(null);
                  setQrImage(null);
                  setQrOpen(false);
                  setError(null);
                }}
                value={selectedSessionId}
              >
                {eligibleSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name} · {formatCompactTimeRange(session.startsAt, session.endsAt)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="coach-attendance-qr-open"
              disabled={loading}
              onClick={() => {
                if (issued && qrImage && !expired) {
                  setQrOpen(true);
                  return;
                }

                void issueQr();
              }}
              type="button"
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <QrCode className="h-4 w-4" aria-hidden />}
              {loading ? "QR 만드는 중" : issued && !expired ? "QR 다시 열기" : "QR 생성"}
            </button>
          </div>
        ) : (
          <p className="mt-4 rounded-md bg-zinc-50 px-3 py-3 text-sm text-zinc-600">
            지금 QR 출석할 수 있는 담당 수업이 없습니다. 수업 30분 전부터 사용할 수 있습니다.
          </p>
        )}

        {error ? <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}
      </section>

      {qrOpen && issued && qrImage && selectedSession ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="presentation">
          <section
            aria-labelledby="coach-qr-title"
            aria-modal="true"
            className="max-h-[96dvh] w-full overflow-y-auto rounded-t-lg bg-white p-4 shadow-xl sm:max-w-lg sm:rounded-lg sm:p-5"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-zinc-950" id="coach-qr-title">수업 출석 QR</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {selectedSession.name} · {formatCompactTimeRange(selectedSession.startsAt, selectedSession.endsAt)}
                </p>
              </div>
              <button
                aria-label="수업 QR 닫기"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                onClick={() => setQrOpen(false)}
                type="button"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <div className="mt-4 flex min-h-[320px] items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="relative">
                <Image
                  alt={`${issued.className} 수업 출석 QR`}
                  className={expired ? "h-auto w-[300px] opacity-25 sm:w-[360px]" : "h-auto w-[300px] sm:w-[360px]"}
                  height={420}
                  priority
                  src={qrImage}
                  unoptimized
                  width={420}
                />
                {expired ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-bold text-white">유효시간 종료</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-zinc-950">회원 휴대폰으로 스캔</p>
                <p className="mt-0.5 text-sm text-zinc-600" aria-live="polite">
                  {expired ? "새 QR을 만들어 주세요" : `${formatRemainingTime(issued.expiresAt, now)} 동안 사용 가능`}
                </p>
              </div>
              <button
                className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading}
                onClick={() => void issueQr()}
                type="button"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                새 QR
              </button>
            </div>

            <p className="mt-4 border-t border-zinc-100 pt-4 text-xs leading-5 text-zinc-500">
              QR은 5분 동안 등록 회원 여러 명이 사용할 수 있습니다. 새 QR을 만들면 이전 QR은 즉시 무효화됩니다.
            </p>
          </section>
        </div>
      ) : null}
    </>
  );
}
