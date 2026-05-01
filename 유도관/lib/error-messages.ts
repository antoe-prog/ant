const DEFAULT_FALLBACK = "처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";

function readErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

export function getFriendlyErrorMessage(error: unknown, fallback = DEFAULT_FALLBACK): string {
  const raw = readErrorMessage(error).trim();
  const lower = raw.toLowerCase();
  if (!raw) return fallback;

  if (
    lower.includes("db not available") ||
    lower.includes("database_url") ||
    lower.includes("database url") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("database")
  ) {
    return "데이터베이스 연결이 확인되지 않았습니다. 서버와 MySQL이 켜져 있고 DATABASE_URL이 설정되어 있는지 확인해 주세요.";
  }

  if (
    lower.includes("network request failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("fetch failed") ||
    lower.includes("load failed") ||
    lower.includes("networkerror")
  ) {
    return "서버에 연결하지 못했습니다. 같은 네트워크인지, API 주소와 터널/도메인 연결이 정상인지 확인해 주세요.";
  }

  if (
    lower.includes("json parse error") ||
    lower.includes("unexpected character") ||
    lower.includes("unexpected token") ||
    lower.includes("invalid json") ||
    lower.includes("cannot get")
  ) {
    return "서버 응답 형식이 올바르지 않습니다. API 주소가 앱 서버를 가리키는지, 터널 경로가 맞는지 확인해 주세요.";
  }

  if (lower.includes("jwt_secret")) {
    return "서버 로그인 설정이 완료되지 않았습니다. JWT_SECRET 환경변수를 설정한 뒤 서버를 다시 시작해 주세요.";
  }

  if (lower.includes("unauthorized") || lower.includes("401")) {
    return "로그인이 만료되었거나 인증이 필요합니다. 다시 로그인해 주세요.";
  }

  if (lower.includes("forbidden") || lower.includes("403")) {
    return "이 기능을 사용할 권한이 없습니다. 관리자 권한 또는 계정 유형을 확인해 주세요.";
  }

  if (lower.includes("not_found") || lower.includes("404")) {
    return "요청한 기능을 찾을 수 없습니다. 앱과 서버가 같은 최신 버전인지 확인해 주세요.";
  }

  return raw;
}

export function getFriendlyErrorTitle(error: unknown): string {
  const lower = readErrorMessage(error).toLowerCase();
  if (
    lower.includes("db not available") ||
    lower.includes("database_url") ||
    lower.includes("database") ||
    lower.includes("econnrefused")
  ) {
    return "DB 연결 확인";
  }
  if (
    lower.includes("network request failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("fetch failed")
  ) {
    return "서버 연결 확인";
  }
  if (lower.includes("unauthorized") || lower.includes("401")) return "로그인 필요";
  if (lower.includes("forbidden") || lower.includes("403")) return "권한 확인";
  return "오류";
}
