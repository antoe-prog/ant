#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reportPath = "docs/P1_OWNER_PROGRESS_REPORT.md";
const report = readFileSync(reportPath, "utf8");
const readme = readFileSync("README.md", "utf8");
const qaPlan = readFileSync("docs/QA_TEST_PLAN.md", "utf8");
const releaseChecklist = readFileSync("docs/RELEASE_CHECKLIST.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

const requiredReportSnippets = [
  "# P1 대표 진행 보고서",
  "보고 기준일: 2026-06-16",
  "비개발자 대표에게 전달할 한 줄",
  "MVP 기능 개발 완료",
  "파일럿 운영 및 앱 배포 전 최종 준비 단계",
  "현재 단계",
  "완료된 것",
  "남은 외부 준비",
  "개발 미완성이 아니라 운영 전 외부 준비",
  "운영 서버/도메인",
  "PostgreSQL 운영 DB",
  "Android APK/AAB",
  "주소창/공유/더보기 브라우저 UI가 없는 Android 실기기 smoke",
  "iOS IPA 실기기/provisioning",
  "iOS 실제 iPhone 등록과 provisioning profile",
  "iOS IPA build/provisioning",
  "결제사",
  "푸시 알림",
  "파일럿 지점",
  "대표 확인/결정 필요",
  "다음 진행 순서",
  "과장해서 말하지 말 것",
  "대표 보고 문안",
  "운영 오픈 완료",
  "APK/AAB 생성 완료",
  "iOS IPA 배포 가능",
  "결제사 실연동 완료",
  "푸시 알림 운영 완료",
];

for (const snippet of requiredReportSnippets) {
  assert(report.includes(snippet), `${reportPath} is missing ${snippet}`);
}

const forbiddenSecretPatterns = [
  /FinalJudoPilot!2026/i,
  /postgres(?:ql)?:\/\/[^:\s/@]+:(?!REDACTED@)[^@\s]+@/i,
  /-----BEGIN PRIVATE KEY-----/i,
  /sk_live_[a-z0-9_]+/i,
];

for (const pattern of forbiddenSecretPatterns) {
  assert(!pattern.test(report), `${reportPath} must not include raw secret-like values`);
}

assert.equal(
  packageJson.scripts["test:owner-progress-report"],
  "node scripts/check-owner-progress-report.mjs",
  "package.json must expose test:owner-progress-report",
);

const requiredDocReferences = [
  { path: "README.md", source: readme },
  { path: "docs/QA_TEST_PLAN.md", source: qaPlan },
  { path: "docs/RELEASE_CHECKLIST.md", source: releaseChecklist },
];

for (const document of requiredDocReferences) {
  assert(document.source.includes("docs/P1_OWNER_PROGRESS_REPORT.md"), `${document.path} must mention the owner progress report`);
  assert(document.source.includes("npm run test:owner-progress-report"), `${document.path} must mention test:owner-progress-report`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "non-developer owner progress report exists",
        "report states MVP completion and P1 pilot/app-release preparation stage",
        "report separates completed development from external operational blockers",
        "report lists owner decisions and anti-overclaiming language",
        "package script and README/QA/release checklist references exist",
        "report does not include raw secret-like values",
      ],
    },
    null,
    2,
  ),
);
