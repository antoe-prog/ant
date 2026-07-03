import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv, validateRows } from "./pilot-data-utils.mjs";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function countRows(records, type) {
  return records.filter(({ row }) => row.type === type).length;
}

function summarizeSourceCsv(records) {
  const branches = records
    .filter(({ row }) => row.type === "branch")
    .map(({ row }) => ({
      name: row.branch_name,
      owner: "TODO: 지점 대표 또는 현장 책임자",
      evidence: "TODO: 지점 확정 회의록, 승인 링크, 또는 캡처 경로",
    }));

  const accounts = records
    .filter(({ row }) => row.type === "user")
    .map(({ row }) => ({
      role: row.role,
      email: row.email.toLowerCase(),
      branchScope: row.role === "admin" ? "all" : row.branch_name,
      passwordRotated: false,
      loginVerified: false,
      evidence: "TODO: 계정별 비밀번호 교체와 로그인 검증 증빙",
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return {
    branches,
    accounts,
    counts: {
      branches: countRows(records, "branch"),
      users: countRows(records, "user"),
      members: countRows(records, "member"),
      classes: countRows(records, "class"),
      payments: countRows(records, "member"),
      notices: countRows(records, "notice"),
    },
  };
}

async function readJsonIfPresent(filePath) {
  const value = text(filePath);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(await readFile(path.resolve(value), "utf8"));
  } catch {
    return null;
  }
}

function pilotPeriodFromArgs(postPilotReport) {
  const startsOn = argValue("--starts-on", "2026-07-01");
  const endsOn = argValue("--ends-on", "2026-07-14");
  const operatingDays = Number(argValue("--operating-days", postPilotReport?.counts?.operationDays ?? "14"));

  return {
    startsOn,
    endsOn,
    operatingDays: Number.isFinite(operatingDays) ? operatingDays : 14,
  };
}

function operationsFromReport(postPilotReport, postPilotEvidenceJson, postPilotEvidenceMarkdown) {
  const counts = postPilotReport?.counts ?? {};

  return {
    operationLogCount: Number(counts.operationDays ?? 0),
    attendanceRecords: Number(counts.attendanceRecordsLogged ?? 0),
    paymentChecks: Number(counts.paymentChecksLogged ?? 0),
    noticeFollowupChecks: Number(counts.noticeFollowupChecksLogged ?? 0),
    noticeChecks: Number(counts.noticeChecksLogged ?? 0),
    unresolvedP0Count: Number(counts.unresolvedIncidents ?? 0),
    postPilotPreflightCommand: argValue(
      "--post-pilot-preflight-command",
      "NODE_ENV=production npm run preflight:pilot -- --require-retro --out=.data/pilot-preflight.post-pilot.json",
    ),
    postPilotEvidenceJson,
    postPilotEvidenceMarkdown,
    feedbackCollected: false,
    verified: false,
    evidence: "TODO: 14일 운영 로그, 회고록, post-pilot preflight 결과",
  };
}

function buildDraft({ sourceCsv, sourceSummary, prePilotEvidence, postPilotEvidence, postPilotMarkdown }) {
  return {
    version: 1,
    pilot: {
      branches: sourceSummary.branches,
      period: pilotPeriodFromArgs(postPilotEvidence),
      signedOffBy: argValue("--signed-off-by", "TODO: 총괄 PM 이름"),
      signedOffAt: argValue("--signed-off-at", "TODO: 2026-07-15T10:00:00+09:00"),
    },
    accounts: sourceSummary.accounts,
    dataImport: {
      sourceCsv,
      dryRunCommand: argValue("--dry-run-command", `npm run test:pilot-import -- ${sourceCsv}`),
      importCommand: argValue("--import-command", `npm run pilot:import:postgres -- ${sourceCsv}`),
      preflightCommand: argValue(
        "--preflight-command",
        "NODE_ENV=production npm run preflight:pilot -- --out=.data/pilot-preflight.pre-pilot.json",
      ),
      evidenceReport: argValue("--pre-pilot-evidence", ".data/pilot-evidence.json"),
      sensitiveDataReviewed: false,
      verified: false,
      evidence: prePilotEvidence
        ? "TODO: dry-run/import/preflight 결과 링크 또는 파일 경로"
        : "TODO: pre-pilot evidence JSON 생성 후 dry-run/import/preflight 결과 링크 또는 파일 경로",
    },
    fieldChecks: {
      mobileAttendance: [
        {
          deviceKind: "ios",
          device: "TODO: iPhone 모델",
          browser: "Safari",
          route: "/app/classes",
          durationSeconds: 0,
          touchTargetsVerified: false,
          noHorizontalOverflow: false,
          offlineQueueVerified: false,
          evidence: "TODO: iOS 출석 처리 녹화/캡처",
        },
        {
          deviceKind: "android",
          device: "TODO: Android 모델",
          browser: "Chrome",
          route: "/app/classes",
          durationSeconds: 0,
          touchTargetsVerified: false,
          noHorizontalOverflow: false,
          offlineQueueVerified: false,
          evidence: "TODO: Android 출석 처리 녹화/캡처",
        },
        {
          deviceKind: "tablet",
          device: "TODO: tablet 모델",
          browser: "TODO: Safari, Chrome 등",
          route: "/app/classes",
          durationSeconds: 0,
          touchTargetsVerified: false,
          noHorizontalOverflow: false,
          offlineQueueVerified: false,
          evidence: "TODO: tablet 출석 처리 녹화/캡처",
        },
      ],
      screenReader: [
        {
          tool: "TODO: VoiceOver 또는 TalkBack",
          role: "coach",
          route: "/app/classes",
          target: "attendance-status",
          expectedAnnouncement: "TODO: 출석 상태 버튼에서 기대한 낭독 문구",
          actualAnnouncement: "TODO: 현장 스크린리더가 실제 읽은 문구",
          passed: false,
          issueFree: false,
          notes: "TODO: 낭독 순서, 상태 변화, 보완 필요 여부",
          evidence: "TODO: 출석 상태 스크린리더 녹화/캡처",
        },
        {
          tool: "TODO: VoiceOver 또는 TalkBack",
          role: "guardian",
          route: "/app/notices",
          target: "notice-read-state",
          expectedAnnouncement: "TODO: 공지 읽음 상태에서 기대한 낭독 문구",
          actualAnnouncement: "TODO: 현장 스크린리더가 실제 읽은 문구",
          passed: false,
          issueFree: false,
          notes: "TODO: 읽음/미읽음 상태 구분과 보완 필요 여부",
          evidence: "TODO: 공지 읽음 상태 스크린리더 녹화/캡처",
        },
      ],
      keyboardNavigation: {
        passed: false,
        evidence: "TODO: 키보드 탐색 확인 증빙",
      },
      privacyMaskingVerified: false,
      incidentChannel: {
        name: "TODO: 파일럿 장애 보고 채널",
        owner: "TODO: 장애 접수 책임자",
        verified: false,
        evidence: "TODO: 채널 생성/권한/담당자 확인 증빙",
      },
    },
    operations: operationsFromReport(postPilotEvidence, argValue("--post-pilot-evidence", ".data/pilot-evidence.post-pilot.json"), postPilotMarkdown),
    environment: {
      productionPreflightPassed: false,
      demoLoginDisabled: false,
      devResetDisabled: false,
      evidence: "TODO: production 환경 변수와 preflight 결과",
    },
    draftMeta: {
      generatedAt: new Date().toISOString(),
      sourceCsvCounts: sourceSummary.counts,
      prePilotEvidenceFound: Boolean(prePilotEvidence),
      postPilotEvidenceFound: Boolean(postPilotEvidence),
      postPilotMarkdown: postPilotMarkdown,
      checked: [
        "source CSV branch and account rows copied",
        "data import commands generated from source CSV",
        "post-pilot operation counts copied when report is available",
        "field-only evidence remains TODO/false until verified by operators",
      ],
    },
  };
}

async function main() {
  const sourceCsv = argValue("--source-csv", "docs/pilot-templates/pilot-data-intake.csv");
  const outPath = path.resolve(argValue("--out", ".data/pilot-field-evidence.json"));
  const rawCsv = await readFile(path.resolve(sourceCsv), "utf8");
  const parsed = parseCsv(rawCsv);
  const { errors, records } = validateRows(parsed);

  if (errors.length > 0) {
    console.error(`source CSV must pass pilot validation before creating a field evidence draft:\n${errors.join("\n")}`);
    process.exit(1);
  }

  const prePilotEvidencePath = argValue("--pre-pilot-evidence", ".data/pilot-evidence.json");
  const postPilotEvidencePath = argValue("--post-pilot-evidence", ".data/pilot-evidence.post-pilot.json");
  const postPilotMarkdown = argValue("--post-pilot-markdown", ".data/pilot-evidence.md");
  const draft = buildDraft({
    sourceCsv,
    sourceSummary: summarizeSourceCsv(records),
    prePilotEvidence: await readJsonIfPresent(prePilotEvidencePath),
    postPilotEvidence: await readJsonIfPresent(postPilotEvidencePath),
    postPilotMarkdown,
  });

  const serialized = `${JSON.stringify(draft, null, 2)}\n`;
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, serialized, "utf8");
  process.stdout.write(serialized);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
