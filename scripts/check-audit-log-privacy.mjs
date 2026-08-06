import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

const { sanitizeAuditLog, sanitizeAuditPayload } = await import("../src/lib/audit-log-security.ts");
const { getAuditPayloadChanges } = await import("../src/lib/audit-log-presentation.ts");

const rawPayload = {
  alerts: ["견과류 알레르기", "무릎 통증"],
  content: "보호자에게만 공개할 상담 내용",
  email: "member@example.com",
  identifier: "010-1234-5678",
  nested: {
    email: "guardian@example.com",
    endpoint: "https://push.example.com/private-subscription",
  },
  note: "출석 사유 연락 010-1234-5678",
  passwordHash: "raw-password-hash",
  phone: "010-1234-5678",
  reason: "연락처 010-1234-5678 확인",
  invitationToken: "raw-invitation-token",
};
const sanitizedPayload = sanitizeAuditPayload(rawPayload);
const serializedPayload = JSON.stringify(sanitizedPayload);

assert.equal(sanitizedPayload.email, "m***@example.com", "audit email must be masked");
assert.equal(sanitizedPayload.phone, "010-****-5678", "audit phone must be masked");
assert.equal(sanitizedPayload.identifier, "010-****-5678", "audit account identifier must be masked");
assert.equal(sanitizedPayload.passwordHash, "[보호됨]", "audit password hash must be removed");
assert.equal(sanitizedPayload.invitationToken, "[보호됨]", "audit invitation token must be removed");
assert.equal(sanitizedPayload.alerts, "[민감 내용 2건]", "audit health alerts must retain only a count");
assert.equal(sanitizedPayload.content, "[민감 내용]", "audit free-form content must not retain its raw value");
assert.equal(sanitizedPayload.reason, "연락처 010-****-5678 확인", "phone numbers inside reasons must be masked");
assert.equal(sanitizedPayload.note, "출석 사유 연락 010-****-5678", "attendance audit notes must keep evidence while masking contacts");
assert.deepEqual(
  sanitizedPayload.nested,
  { email: "g***@example.com", endpoint: "[보호됨]" },
  "nested audit values must follow the same privacy policy",
);
for (const rawValue of [
  "견과류 알레르기",
  "무릎 통증",
  "보호자에게만 공개할 상담 내용",
  "member@example.com",
  "guardian@example.com",
  "raw-password-hash",
  "raw-invitation-token",
  "private-subscription",
  "010-1234-5678",
]) {
  assert(!serializedPayload.includes(rawValue), `sanitized audit payload must not retain ${rawValue}`);
}

const sanitizedLog = sanitizeAuditLog({
  action: "user.update",
  actorUserId: "user-admin",
  after: rawPayload,
  before: { email: "old@example.com", phone: "010-0000-1111" },
  branchId: "branch-a",
  createdAt: "2026-07-13T12:00:00.000Z",
  id: "audit-privacy",
  message: "사용자 정보를 수정했습니다.",
  result: "success",
  targetId: "user-member",
  targetType: "user",
});
assert.equal(sanitizedLog.before.email, "o***@example.com", "sanitizeAuditLog must protect before payloads");
assert.equal(sanitizedLog.after.phone, "010-****-5678", "sanitizeAuditLog must protect after payloads");

const rawMemberDeletionLog = {
  action: "member.delete",
  actorUserId: "user-admin",
  after: {
    reason: "중복 등록 회원 김민수 연락 010-1234-5678",
    removedAttendanceCount: 2,
  },
  before: {
    address: "서울시 강서구",
    ageGroup: "adult",
    birthDate: "1990-01-01",
    branchId: "branch-a",
    emergencyContact: "010-1234-5678",
    name: "김민수",
    status: "active",
  },
  branchId: "branch-a",
  createdAt: "2026-07-13T12:00:00.000Z",
  id: "audit-member-delete-privacy",
  message: "회원과 연결된 운영 기록을 삭제했습니다.",
  result: "success",
  targetId: "member-deleted",
  targetType: "member",
};
const sanitizedMemberDeletionLog = sanitizeAuditLog(rawMemberDeletionLog);
assert.deepEqual(
  sanitizedMemberDeletionLog.before,
  { ageGroup: "adult", branchId: "branch-a", status: "active" },
  "member deletion audit must retain only non-identifying operational state",
);
assert.equal(sanitizedMemberDeletionLog.after.reason, undefined, "member deletion audit must not retain a free-text reason");
assert.equal(sanitizedMemberDeletionLog.after.reasonRecorded, true, "member deletion audit must retain reason confirmation");
assert(
  !Object.hasOwn(sanitizedMemberDeletionLog.before, "address") &&
    !Object.hasOwn(sanitizedMemberDeletionLog.before, "birthDate") &&
    !Object.hasOwn(sanitizedMemberDeletionLog.before, "emergencyContact") &&
    !Object.hasOwn(sanitizedMemberDeletionLog.before, "name"),
  "member deletion audit must not retain deleted profile name, address, birth date, or contact fields",
);

const changes = getAuditPayloadChanges(
  { amount: 100000, phone: "010-****-1111", status: "scheduled" },
  { amount: 120000, phone: "010-****-5678", reason: "금액 정정", status: "paid" },
);
assert.deepEqual(
  changes.map(({ label }) => label),
  ["결제 금액", "휴대폰 번호", "상태", "처리 사유"],
  "audit detail changes must use readable field labels",
);
assert.equal(changes[0]?.before, "₩100,000", "audit detail must format previous payment amounts");
assert.equal(changes[0]?.after, "₩120,000", "audit detail must format next payment amounts");
assert.equal(changes[2]?.before, "예정", "audit detail must translate previous status values");
assert.equal(changes[2]?.after, "납부 완료", "audit detail must translate next status values");

const [memberRouteSource, serverDbSource, serverApiSource, adminAuditScreenSource, backendSchemaSource] = await Promise.all([
  readFile("src/app/api/v1/members/[memberId]/route.ts", "utf8"),
  readFile("src/server/db.ts", "utf8"),
  readFile("src/server/api.ts", "utf8"),
  readFile("src/components/screens/admin-audit-logs-screen.tsx", "utf8"),
  readFile("docs/BACKEND_DB_SCHEMA.md", "utf8"),
]);

const memberDeletionSource = memberRouteSource.slice(memberRouteSource.indexOf('action: "member.delete"'));
assert(
  memberDeletionSource.includes("ageGroup: member.ageGroup") &&
    memberDeletionSource.includes("branchId: member.branchId") &&
    memberDeletionSource.includes("status: member.status") &&
    !memberDeletionSource.includes("name: member.name"),
  "member deletion route must not place the deleted member name in its audit snapshot",
);

assert(serverDbSource.includes('from "@/lib/audit-log-security"'), "server DB must import audit privacy policy");
assert(
  serverDbSource.includes("auditLogs: db.auditLogs.map(sanitizeAuditLog)"),
  "server DB must sanitize every audit log before persistence",
);
assert(
  serverDbSource.includes("serverDbStore.write(sanitizeDatabaseAuditLogs({"),
  "server DB writes must enforce audit privacy centrally",
);
assert(
  serverApiSource.includes('log.branchId !== null && branchIds.includes(log.branchId)'),
  "owner bootstrap must exclude global and out-of-scope audit logs",
);
assert(
  serverApiSource.includes('log.targetType === "attendance"') &&
    serverApiSource.includes("log.actorUserId === user.id") &&
    serverApiSource.includes(": []"),
  "coach bootstrap must only include own scoped attendance history and family roles must receive no audit logs",
);
assert(adminAuditScreenSource.includes("getAuditPayloadChanges"), "admin audit detail must use readable change rows");
assert(adminAuditScreenSource.includes('data-testid="admin-audit-change-row"'), "admin audit detail must expose change rows");
assert(
  adminAuditScreenSource.includes('url.searchParams.set("detail", openDetailLogId)'),
  "admin audit detail must persist its selected record in the URL",
);
assert(!adminAuditScreenSource.includes("JSON.stringify(payload"), "admin audit detail must not render raw JSON payloads");
assert(!adminAuditScreenSource.includes("<pre"), "admin audit detail must not render developer-style preformatted payloads");
assert(backendSchemaSource.includes("휴대폰·이메일·계정 식별값"), "DB policy must document audit PII masking");

const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "final-judo-audit-privacy-"));
process.env.FINAL_JUDO_DATA_DIR = dataDirectory;
process.env.FINAL_JUDO_DB_DRIVER = "json";
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(process.cwd(), "src") },
});
const { createMockData } = await jiti.import("../src/lib/mock-data.ts");
const {
  closeServerDb,
  serverDbPaths,
  writeServerDb,
} = await jiti.import("../src/server/db.ts");

try {
  const seeded = createMockData();
  await writeServerDb({
    ...seeded,
    auditLogs: [rawMemberDeletionLog, ...seeded.auditLogs],
  });

  assert(serverDbPaths?.dataFile, "isolated audit privacy test must expose its data file");
  const persisted = JSON.parse(await readFile(serverDbPaths.dataFile, "utf8"));
  const persistedDeletionLog = persisted.auditLogs.find((log) => log.id === rawMemberDeletionLog.id);
  assert(persistedDeletionLog, "member deletion audit must be persisted for accountability");
  assert.deepEqual(
    persistedDeletionLog.before,
    { ageGroup: "adult", branchId: "branch-a", status: "active" },
    "the source store must contain only minimized member deletion state",
  );
  assert.equal(persistedDeletionLog.after.reason, undefined, "the source store must not retain the deletion reason text");
  assert.equal(persistedDeletionLog.after.reasonRecorded, true, "the source store must retain reason confirmation");
} finally {
  await closeServerDb();
  await rm(dataDirectory, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "audit phone, email, identifier, credential, endpoint, and sensitive content masking",
        "nested and free-text contact redaction",
        "member deletion profile and free-text reason minimization",
        "persisted member deletion audit minimization in an isolated source store",
        "central server read/write audit sanitization",
        "readable before/after audit detail rows without raw JSON",
        "audit detail URL restoration",
        "audit privacy database documentation",
      ],
      sampleChanges: changes,
    },
    null,
    2,
  ),
);
