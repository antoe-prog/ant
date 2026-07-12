import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

const [serverDbSource, adminAuditScreenSource, backendSchemaSource] = await Promise.all([
  readFile("src/server/db.ts", "utf8"),
  readFile("src/components/screens/admin-audit-logs-screen.tsx", "utf8"),
  readFile("docs/BACKEND_DB_SCHEMA.md", "utf8"),
]);

assert(serverDbSource.includes('from "@/lib/audit-log-security"'), "server DB must import audit privacy policy");
assert(
  serverDbSource.includes("auditLogs: db.auditLogs.map(sanitizeAuditLog)"),
  "server DB must sanitize every audit log before persistence",
);
assert(
  serverDbSource.includes("serverDbStore.write(sanitizeDatabaseAuditLogs(db))"),
  "server DB writes must enforce audit privacy centrally",
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

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "audit phone, email, identifier, credential, endpoint, and sensitive content masking",
        "nested and free-text contact redaction",
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
