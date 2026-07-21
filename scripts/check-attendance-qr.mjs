import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMockData } from "../src/lib/mock-data.ts";
import { attendanceQrLifetimeMs } from "../src/lib/attendance-qr-policy.ts";
import {
  createAttendanceQrChallenge,
  findAttendanceQrChallenge,
  redeemAttendanceQrChallenge,
} from "../src/server/attendance-qr.ts";

const now = new Date("2026-07-21T09:00:00+09:00");
const db = createMockData();
const coach = db.users.find((candidate) => candidate.id === "user-coach");
const session = db.classes.find((candidate) => candidate.id === "class-adult-night");

assert(coach && session, "coach QR fixtures must exist");

const issued = createAttendanceQrChallenge(db, {
  branchId: session.branchId,
  sessionId: session.id,
  userId: coach.id,
  now,
});

assert.match(issued.payload, /^final-judo:attendance:[A-Za-z0-9_-]{40,64}$/);
assert.equal(JSON.stringify(issued.db).includes(issued.payload), false, "raw QR payload must never be persisted");
assert.match(issued.challenge.tokenHash, /^[a-f0-9]{64}$/);
assert.equal(issued.challenge.sessionId, session.id);
assert.deepEqual(issued.challenge.redeemedMemberIds, []);
assert.equal(Date.parse(issued.challenge.expiresAt) - now.getTime(), attendanceQrLifetimeMs);
assert.equal(findAttendanceQrChallenge(issued.db, issued.payload, now).ok, true);
assert.deepEqual(findAttendanceQrChallenge(issued.db, "not-a-final-judo-code", now), { ok: false, reason: "invalid" });

const expiredLookup = findAttendanceQrChallenge(
  issued.db,
  issued.payload,
  new Date(Date.parse(issued.challenge.expiresAt) + 1),
);
assert.deepEqual(expiredLookup, { ok: false, reason: "expired" });

const firstRedemption = redeemAttendanceQrChallenge(issued.db, issued.challenge.id, "member-minjae");
const secondRedemption = redeemAttendanceQrChallenge(firstRedemption, issued.challenge.id, "member-jiho");
const idempotentRedemption = redeemAttendanceQrChallenge(secondRedemption, issued.challenge.id, "member-minjae");
const redeemedChallenge = idempotentRedemption.attendanceQrChallenges.find(
  (candidate) => candidate.id === issued.challenge.id,
);

assert.deepEqual(
  redeemedChallenge?.redeemedMemberIds,
  ["member-minjae", "member-jiho"],
  "one coach QR must support multiple members without duplicate redemption IDs",
);
assert.equal(
  findAttendanceQrChallenge(idempotentRedemption, issued.payload, now).ok,
  true,
  "one member redemption must not consume the class QR for everyone",
);

const reissued = createAttendanceQrChallenge(issued.db, {
  branchId: session.branchId,
  sessionId: session.id,
  userId: coach.id,
  now: new Date(now.getTime() + 1_000),
});
assert.deepEqual(findAttendanceQrChallenge(reissued.db, issued.payload, now), { ok: false, reason: "invalid" });
assert.equal(findAttendanceQrChallenge(reissued.db, reissued.payload, now).ok, true);

const [issueRoute, scanRoute, dashboardSource, qrComponentSource, serverApiSource] = await Promise.all([
  readFile("src/app/api/v1/me/attendance-qr/route.ts", "utf8"),
  readFile("src/app/api/v1/attendance-qr/scan/route.ts", "utf8"),
  readFile("src/components/screens/dashboard-screen.tsx", "utf8"),
  readFile("src/components/domain/attendance-qr.tsx", "utf8"),
  readFile("src/server/api.ts", "utf8"),
]);

for (const snippet of [
  "user: initialUser",
  "canIssueAttendanceQr",
  'user.role === "coach" && session.coachId !== user.id',
  "createAttendanceQrChallenge",
  "withServerDbLock(attendanceStateLockKey",
]) {
  assert(issueRoute.includes(snippet), `coach QR issue route is missing ${snippet}`);
}

for (const snippet of [
  "user: initialUser",
  'initialUser.role !== "member" && initialUser.role !== "guardian"',
  "user.memberIds?.includes(scanBody.memberId)",
  'user.role === "guardian" && member.ageGroup !== "adult"',
  "getAccessibleBranchIds(issuingUser, db).includes(session.branchId)",
  "issuingUser.role === \"coach\" && session.coachId !== issuingUser.id",
  "const autoEnrolled = !session.enrolledMemberIds.includes(member.id)",
  'source: "attendance_qr"',
  "redeemedMemberIds.includes(member.id)",
  "redeemAttendanceQrChallenge",
  "withServerDbLock(attendanceStateLockKey",
]) {
  assert(scanRoute.includes(snippet), `member QR scan route is missing ${snippet}`);
}

assert(!issueRoute.includes("isAttendanceQrWindowOpen"), "QR issue route must not enforce a class time window");
assert(!scanRoute.includes("isAttendanceQrWindowOpen"), "QR scan route must not enforce a class time window");
assert(!qrComponentSource.includes("수업 30분 전부터"), "coach QR UI must not advertise a retired time restriction");

assert(
  issueRoute.indexOf("user: initialUser") < issueRoute.indexOf("const body = parseBody"),
  "coach QR issue route must authenticate before validating the body",
);
assert(
  scanRoute.indexOf("user: initialUser") < scanRoute.indexOf("const body = parseBody"),
  "member QR scan route must authenticate before validating the body",
);

assert(dashboardSource.includes("<MemberAttendanceQrScannerCard"), "member home must render the QR scanner card");
assert(
  dashboardSource.includes('getGuardianMemberRelation(context.user, selectedChild) === "self"'),
  "a guardian who also trains must see the scanner only on the adult self profile",
);
assert(dashboardSource.includes("<CoachAttendanceQrCard"), "coach home must render the class QR card");
assert(qrComponentSource.includes('data-testid="member-attendance-qr-card"'));
assert(qrComponentSource.includes('data-testid="coach-attendance-qr-card"'));
assert(qrComponentSource.includes("decodeFromVideoDevice"), "member scanner must use the device camera");
assert(qrComponentSource.includes("QRCode.toDataURL"), "coach card must render the class QR");
assert(
  serverApiSource.includes("attendanceQrChallenges: []"),
  "bootstrap snapshot must never expose QR challenge hashes or redemption IDs",
);

console.log(
  JSON.stringify({
    ok: true,
    checked: [
      "coach-issued opaque hashed class QR storage",
      "five-minute expiration",
      "multi-member redemption and per-member deduplication",
      "reissue invalidation",
      "bootstrap challenge redaction",
      "unrestricted issue and scan timing",
      "unregistered member auto-enrollment contract",
      "coach issue and member scan authorization guards",
      "guardian adult self scan without child proxy attendance",
      "issuer branch access revalidation",
      "member scanner and coach class QR dashboard integration",
    ],
  }),
);
