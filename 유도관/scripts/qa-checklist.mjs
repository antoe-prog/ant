import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || "https://api.judokan.store").replace(/\/$/, "");
const OUTPUT_DIR = "build-artifacts";

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

async function checkHealth() {
  const url = `${API_BASE_URL}/api/health`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok && Boolean(body?.ok),
      detail: response.ok ? JSON.stringify(body) : `HTTP ${response.status}`,
      url,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      url,
    };
  }
}

function checkboxLines(items) {
  return items.map((item) => `- [ ] ${item}`).join("\n");
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const health = await checkHealth();
  const fileName = `qa-checklist-${stamp()}.md`;
  const outPath = join(OUTPUT_DIR, fileName);

  const content = `# 유도관 실기기 QA 체크리스트

생성 시각: ${new Date().toLocaleString("ko-KR")}
API: ${API_BASE_URL}
Health: ${health.ok ? "정상" : "확인 필요"} (${health.url})
Health detail: \`${health.detail.replace(/`/g, "'")}\`

## 공통 준비
${checkboxLines([
  "기존 앱 삭제 후 최신 APK 설치",
  "회원 앱과 관리자 앱 아이콘/앱 이름이 구분되는지 확인",
  "같은 계정으로 잘못된 앱에 로그인했을 때 적절히 차단되는지 확인",
  "네트워크 OFF 상태에서 사용자용 오류 메시지가 보이는지 확인",
  "서버/API/DB가 켜진 상태에서 로그인 후 새로고침해도 세션 유지 확인",
])}

## 관리자 앱 핵심 흐름
${checkboxLines([
  "관리자 로그인",
  "회원 등록: 이름, 전화, 이메일, 생년월일, 입관일, 월 회비 입력",
  "회원 목록 검색/띠/상태/미납/메모 필터 확인",
  "출석 수동 등록, QR 출석 등록, 일괄 출석 등록",
  "납부 등록, 등록기간 표시, 영수증 공유",
  "승급 심사 등록, 결과 처리, 띠 자동 승급 확인",
  "대회 등록, 참가자 체급/부문/결과/안내사항 확인",
  "공지 등록/수정/삭제 및 회원 앱 표시 확인",
  "관리자 설정에서 사용자 권한과 회원 계정 연결 확인",
])}

## 회원 앱 핵심 흐름
${checkboxLines([
  "회원 로그인",
  "내 QR 출석증 표시",
  "내 일정에서 승급/납부 예정 확인",
  "내 도장 정보 수정",
  "출석 캘린더 월간 기록/사진 기록/연간 기록 확인",
  "대회 상세에서 참가 정보/체급/비용/안내사항 확인",
  "납부현황에서 등록기간과 납부내역 확인",
  "라이트/다크 모드 전환 후 글자 대비 확인",
])}

## 회귀 확인
${checkboxLines([
  "앱 내부 진단 화면에서 API/DB/인증 상태 확인",
  "잘못된 날짜/금액/전화번호 입력 시 앱에서 먼저 안내하는지 확인",
  "권한 없는 화면 직접 접근 시 관리자 앱 안내 또는 권한 없음 안내 표시",
  "재설치 후 로그인/회원가입이 API 도메인으로 정상 연결되는지 확인",
])}
`;

  writeFileSync(outPath, content, "utf8");
  console.log(`[qa] checklist written: ${outPath}`);
  if (!health.ok) {
    console.warn("[qa] api health needs attention before device QA");
  }
}

main().catch((error) => {
  console.error("[qa] failed");
  console.error(error);
  process.exit(1);
});
