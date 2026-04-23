import * as Linking from "expo-linking";

/** 초대 토큰을 커스텀 스킴 URL에서 추출 (쿼리, path, 레거시 judomanager 지원) */
export function parseInviteTokenFromUrl(url: string): string | null {
  const parsed = Linking.parse(url);
  const qp = parsed.queryParams?.token;
  if (qp != null) {
    const v = Array.isArray(qp) ? qp[0] : qp;
    if (v) return decodeURIComponent(String(v));
  }
  const path = (parsed.path ?? "").replace(/^\//, "");
  const pathMatch = /^invite\/(.+)$/.exec(path);
  if (pathMatch) return decodeURIComponent(pathMatch[1]);

  if (parsed.hostname === "invite") {
    const seg = (parsed.path ?? "").replace(/^\//, "");
    if (seg) return decodeURIComponent(seg);
  }

  // judomanager://invite/TOKEN
  if (parsed.scheme === "judomanager" && path.startsWith("invite/")) {
    const rest = path.slice("invite/".length);
    if (rest) return decodeURIComponent(rest);
  }

  return null;
}
