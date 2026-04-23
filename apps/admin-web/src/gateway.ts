export function resolveGatewayBase(): string {
  const configured = import.meta.env.VITE_GATEWAY_URL;
  if (configured && configured.trim()) {
    return configured.trim();
  }

  // 프로덕션 빌드는 gateway가 /admin/ 하위로 직접 서빙하므로 same-origin 사용.
  if (import.meta.env.BASE_URL && import.meta.env.BASE_URL !== "/") {
    return window.location.origin;
  }

  // 개발(vite dev, :5173)에서는 호스트는 유지하고 포트만 :8000으로 바꾼다.
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const host = window.location.hostname || "127.0.0.1";
  return `${protocol}//${host}:8000`;
}
