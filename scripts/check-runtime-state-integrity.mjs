import assert from "node:assert/strict";

const {
  RuntimeStateWriteIntegrityError,
  assertNoNewRuntimeStateIntegrityIssues,
  inspectRuntimeStateIntegrity,
  reconcileRuntimeStateIntegrity,
  validateRuntimeStateIntegrity,
} = await import("../src/server/runtime-state-integrity.ts");
const { mergeRuntimeState } = await import("../src/server/runtime-state-merge.ts");

function emptyRuntimeState() {
  return {
    branches: [],
    users: [],
    members: [],
    classes: [],
    attendance: [],
    counselingNotes: [],
    promotions: [],
    tournaments: [],
    payments: [],
    notices: [],
    authSessions: [],
    passwordResetChallenges: [],
    phoneSignupChallenges: [],
    attendanceQrChallenges: [],
    pushSubscriptions: [],
    pushDispatchJobs: [],
    pilotReadinessChecks: [],
    pilotIncidents: [],
    pilotOperationLogs: [],
    auditLogs: [],
  };
}

function createIdSequence(prefix) {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

const clean = {
  ...emptyRuntimeState(),
  branches: [{ id: "branch-a" }],
  users: [
    { id: "admin-global", branchIds: [], email: "admin@example.test", phone: "01000001111", role: "admin" },
    { id: "coach-a", branchIds: ["branch-a"], email: "coach@example.test", phone: "01011112222", role: "coach" },
    { id: "owner-a", branchIds: ["branch-a"], email: "owner@example.test", phone: "01022223333", role: "owner" },
    { id: "guardian-a", branchIds: ["branch-a"], email: "guardian@example.test", phone: "01033334444", role: "guardian" },
  ],
  members: [{ id: "member-a", branchId: "branch-a", guardianIds: ["guardian-a"], primaryCoachId: "coach-a" }],
  classes: [{ id: "class-a", branchId: "branch-a", coachId: "coach-a", enrolledMemberIds: ["member-a"] }],
  attendance: [{ id: "attendance-a", sessionId: "class-a", memberId: "member-a" }],
  payments: [{ id: "payment-a", branchId: "branch-a", memberId: "member-a" }],
};

assert.equal(validateRuntimeStateIntegrity(clean), clean, "validation must preserve a valid object reference");
assert.deepEqual(inspectRuntimeStateIntegrity(clean), [], "valid runtime state must have no compatibility issues");
assert.deepEqual(
  assertNoNewRuntimeStateIntegrityIssues(null, clean),
  clean,
  "a clean initial runtime write must pass integrity validation",
);
assert.throws(
  () => assertNoNewRuntimeStateIntegrityIssues(null, {
    ...clean,
    members: clean.members.map((member) => ({ ...member, primaryCoachId: "missing-initial-coach" })),
  }),
  RuntimeStateWriteIntegrityError,
  "an initial runtime write must reject dangling references",
);
assert.deepEqual(
  assertNoNewRuntimeStateIntegrityIssues(null, emptyRuntimeState()),
  emptyRuntimeState(),
  "an empty bootstrap state must remain valid before users and branches are seeded",
);
assert.throws(
  () => validateRuntimeStateIntegrity({ ...clean, notices: [{ id: "", branchId: "branch-a" }] }),
  /notices.id/,
  "empty collection IDs must be rejected",
);

const malformedMemberDeletionAuditState = {
  ...clean,
  auditLogs: [{
    id: "audit-member-delete-malformed-time",
    branchId: "branch-a",
    actorUserId: "admin-global",
    action: "member.delete",
    targetType: "member",
    targetId: "member-deleted",
    before: { ageGroup: "adult", branchId: "branch-a", status: "active" },
    after: { reasonRecorded: true },
    result: "success",
    message: "회원과 연결된 운영 기록을 삭제했습니다.",
    createdAt: "invalid-member-deletion-time",
  }],
};
assert.equal(
  validateRuntimeStateIntegrity(malformedMemberDeletionAuditState),
  malformedMemberDeletionAuditState,
  "legacy malformed deletion audits must remain readable for explicit diagnosis",
);
assert(
  inspectRuntimeStateIntegrity(malformedMemberDeletionAuditState).some(
    (issue) => issue.rule === "auditLogs.memberDeleteCreatedAt" && issue.repairable,
  ),
  "malformed member deletion audit timestamps must be diagnosed as repairable blockers",
);
assert.throws(
  () => assertNoNewRuntimeStateIntegrityIssues(clean, malformedMemberDeletionAuditState),
  (error) =>
    error instanceof RuntimeStateWriteIntegrityError &&
    error.issues.some((issue) => issue.rule === "auditLogs.memberDeleteCreatedAt"),
  "new malformed member deletion audit timestamps must be rejected",
);
const malformedAuditRepair = reconcileRuntimeStateIntegrity(malformedMemberDeletionAuditState, {
  actorUserId: "admin-global",
  createId: createIdSequence("audit-member-delete-time-repair"),
  now: "2026-08-06T00:00:00.000Z",
});
assert.equal(
  malformedAuditRepair.db.auditLogs.find((log) => log.id === "audit-member-delete-malformed-time")?.createdAt,
  "2026-08-06T00:00:00.000Z",
  "explicit reconciliation must restore a deterministic retention start time",
);
assert(
  malformedAuditRepair.db.auditLogs.some(
    (log) => log.action === "system.integrity.repair" && log.targetId === "audit-member-delete-malformed-time",
  ),
  "repairing a member deletion audit timestamp must emit an audit record",
);
assert(
  !malformedAuditRepair.unresolvedIssues.some((issue) => issue.rule === "auditLogs.memberDeleteCreatedAt"),
  "the repaired member deletion audit timestamp must clear its retention blocker",
);

const deletedMemberState = {
  ...clean,
  members: [],
  classes: clean.classes.map((session) => ({ ...session, enrolledMemberIds: [] })),
  attendance: [],
  payments: [],
};
const concurrentMemberWrites = {
  ...clean,
  counselingNotes: [{
    id: "note-concurrent",
    branchId: "branch-a",
    memberId: "member-a",
    authorUserId: "coach-a",
  }],
  promotions: [{
    id: "promotion-concurrent",
    branchId: "branch-a",
    memberId: "member-a",
  }],
  tournaments: [{
    id: "tournament-concurrent",
    scope: "branch",
    branchId: "branch-a",
    registrations: [{ id: "registration-concurrent", memberId: "member-a" }],
  }],
  attendanceQrChallenges: [{
    id: "attendance-qr-concurrent",
    tokenHash: "a".repeat(64),
    userId: "coach-a",
    branchId: "branch-a",
    sessionId: "class-a",
    redeemedMemberIds: ["member-a"],
    createdAt: "2026-07-14T00:00:00.000Z",
    expiresAt: "2026-07-14T01:00:00.000Z",
  }],
};
const memberDeleteRaceResult = mergeRuntimeState(clean, deletedMemberState, concurrentMemberWrites);
assert.equal(memberDeleteRaceResult.members.length, 0, "the regression fixture must delete the member");
assert.equal(memberDeleteRaceResult.counselingNotes.length, 1, "the regression fixture must retain the concurrent note");
assert.equal(memberDeleteRaceResult.promotions.length, 1, "the regression fixture must retain the concurrent promotion");
assert.equal(memberDeleteRaceResult.tournaments[0].registrations.length, 1, "the regression fixture must retain the concurrent registration");
assert.equal(memberDeleteRaceResult.attendanceQrChallenges[0].redeemedMemberIds.length, 1, "the regression fixture must retain the concurrent QR redemption");
const memberDeleteRaceRules = new Set(inspectRuntimeStateIntegrity(memberDeleteRaceResult).map((issue) => issue.rule));
for (const rule of [
  "counselingNotes.references",
  "promotions.references",
  "tournaments.registrations",
  "attendanceQrChallenges.references",
]) {
  assert(memberDeleteRaceRules.has(rule), `a deleted-member race must diagnose ${rule}`);
}
assert.throws(
  () => assertNoNewRuntimeStateIntegrityIssues(clean, memberDeleteRaceResult),
  (error) =>
    error instanceof RuntimeStateWriteIntegrityError &&
    [
      "counselingNotes.references",
      "promotions.references",
      "tournaments.registrations",
      "attendanceQrChallenges.references",
    ].every((rule) => error.issues.some((issue) => issue.rule === rule)),
  "write validation must reject every dangling member reference created by a delete race",
);

const legacyBranchScope = {
  ...clean,
  users: clean.users.map((user) => user.id === "owner-a" ? { ...user, branchIds: ["branch-a", "missing-branch"] } : user),
};
assert.equal(
  validateRuntimeStateIntegrity(legacyBranchScope),
  legacyBranchScope,
  "legacy branch references must remain readable for explicit diagnosis",
);
assert(
  inspectRuntimeStateIntegrity(legacyBranchScope).some((issue) => issue.rule === "users.branchIds"),
  "legacy branch references must be diagnosed",
);
const legacyEntityBranches = {
  ...clean,
  members: clean.members.map((member) => ({ ...member, branchId: "missing-branch" })),
  classes: clean.classes.map((session) => ({ ...session, branchId: "missing-branch" })),
  notices: [{ id: "notice-missing-branch", branchId: "missing-branch" }],
};
assert.equal(
  validateRuntimeStateIntegrity(legacyEntityBranches),
  legacyEntityBranches,
  "legacy entity branch references must not prevent runtime diagnosis",
);
const legacyEntityBranchRules = new Set(inspectRuntimeStateIntegrity(legacyEntityBranches).map((issue) => issue.rule));
assert(legacyEntityBranchRules.has("members.branchId"), "missing member branches must be diagnosed");
assert(legacyEntityBranchRules.has("classes.branchId"), "missing class branches must be diagnosed");
assert(legacyEntityBranchRules.has("notices.branchId"), "missing notice branches must be diagnosed");

const legacy = {
  ...clean,
  users: clean.users.filter((user) => user.id !== "coach-a" && user.id !== "guardian-a"),
  classes: [
    ...clean.classes,
    { id: "class-orphan", branchId: "branch-a", coachId: "missing-coach", enrolledMemberIds: ["missing-member"] },
  ],
  attendance: [
    ...clean.attendance,
    { id: "attendance-history", sessionId: "missing-class", memberId: "member-a" },
  ],
  payments: [
    ...clean.payments,
    { id: "payment-history", branchId: "branch-a", memberId: "missing-member" },
  ],
};
const legacySnapshot = structuredClone(legacy);

assert.equal(validateRuntimeStateIntegrity(legacy), legacy, "validation must not auto-repair legacy references");
assert.deepEqual(legacy, legacySnapshot, "validation must not mutate legacy runtime state");
const legacyIssues = inspectRuntimeStateIntegrity(legacy);
assert(legacyIssues.some((issue) => issue.rule === "members.primaryCoachId"), "missing member coach must be diagnosed");
assert(legacyIssues.some((issue) => issue.rule === "classes.coachId"), "missing class coach must be diagnosed");
assert(legacyIssues.some((issue) => issue.rule === "payments.references" && !issue.repairable), "payment history must be diagnosed without deletion repair");
assert.throws(
  () => reconcileRuntimeStateIntegrity(legacy, { actorUserId: "system" }),
  /auditLogs.actorUserId/,
  "reconciliation must reject an audit actor that is not an existing admin",
);

assert.deepEqual(
  assertNoNewRuntimeStateIntegrityIssues(legacy, structuredClone(legacy)),
  legacy,
  "an unchanged legacy issue set must remain writable",
);
assert.throws(
  () => assertNoNewRuntimeStateIntegrityIssues(legacy, {
    ...legacy,
    notices: [{ id: "notice-new-damage", branchId: "branch-a", targetClassIds: ["missing-class"], targetMemberIds: [] }],
  }),
  RuntimeStateWriteIntegrityError,
  "a write must reject newly introduced dangling references",
);
const twoBrokenEdges = {
  ...clean,
  notices: [{
    id: "notice-two-edges",
    branchId: "branch-a",
    targetClassIds: [],
    targetMemberIds: ["missing-member-a", "missing-member-b"],
  }],
};
const oneBrokenEdge = {
  ...twoBrokenEdges,
  notices: [{ ...twoBrokenEdges.notices[0], targetMemberIds: ["missing-member-b"] }],
};
assert.deepEqual(
  assertNoNewRuntimeStateIntegrityIssues(twoBrokenEdges, oneBrokenEdge),
  oneBrokenEdge,
  "removing one broken edge must not make the remaining legacy edge look new",
);
const repeatedBrokenEdge = {
  ...oneBrokenEdge,
  notices: [{ ...oneBrokenEdge.notices[0], targetMemberIds: ["missing-member-b", "missing-member-b"] }],
};
assert.throws(
  () => assertNoNewRuntimeStateIntegrityIssues(oneBrokenEdge, repeatedBrokenEdge),
  RuntimeStateWriteIntegrityError,
  "increasing the count of an existing broken edge must be rejected",
);

const twoAdminState = {
  ...clean,
  users: [
    ...clean.users,
    { id: "admin-second", branchIds: [], email: "admin-second@example.test", phone: "01044445555", role: "admin" },
  ],
};
const demoteFirstAdmin = {
  ...twoAdminState,
  users: twoAdminState.users.map((user) => user.id === "admin-global" ? { ...user, role: "coach", branchIds: ["branch-a"] } : user),
};
const demoteSecondAdmin = {
  ...twoAdminState,
  users: twoAdminState.users.map((user) => user.id === "admin-second" ? { ...user, role: "coach", branchIds: ["branch-a"] } : user),
};
const mergedAdminDemotions = mergeRuntimeState(twoAdminState, demoteFirstAdmin, demoteSecondAdmin);
assert.equal(
  mergedAdminDemotions.users.filter((user) => user.role === "admin").length,
  0,
  "the regression fixture must reproduce different-user merge loss before write validation",
);
assert.throws(
  () => assertNoNewRuntimeStateIntegrityIssues(twoAdminState, mergedAdminDemotions),
  (error) =>
    error instanceof RuntimeStateWriteIntegrityError &&
    error.issues.some((issue) => issue.rule === "users.activeAdminCoverage"),
  "write validation must reject merged different-user changes that remove every active admin",
);
assert.throws(
  () => assertNoNewRuntimeStateIntegrityIssues(clean, { ...clean, users: [] }),
  (error) =>
    error instanceof RuntimeStateWriteIntegrityError &&
    error.issues.some((issue) => issue.rule === "users.activeAdminCoverage"),
  "write validation must reject removing the entire user collection from a state with active admin coverage",
);
const pendingAdminDoesNotCover = {
  ...twoAdminState,
  users: twoAdminState.users.map((user) =>
    user.id === "admin-second" ? { ...user, invitationStatus: "pending" } : user,
  ),
};
assert.throws(
  () => assertNoNewRuntimeStateIntegrityIssues(pendingAdminDoesNotCover, {
    ...pendingAdminDoesNotCover,
    users: pendingAdminDoesNotCover.users.map((user) =>
      user.id === "admin-global" ? { ...user, role: "coach", branchIds: ["branch-a"] } : user,
    ),
  }),
  (error) =>
    error instanceof RuntimeStateWriteIntegrityError &&
    error.issues.some((issue) => issue.rule === "users.activeAdminCoverage"),
  "a pending admin invitation must not satisfy active administrator coverage",
);
const legacyWithoutAdmin = {
  ...clean,
  users: clean.users.filter((user) => user.role !== "admin"),
};
assert.deepEqual(
  assertNoNewRuntimeStateIntegrityIssues(legacyWithoutAdmin, structuredClone(legacyWithoutAdmin)),
  legacyWithoutAdmin,
  "an unchanged legacy state without an active admin must remain writable for compatibility",
);

const twoOwnerState = {
  ...clean,
  users: [
    ...clean.users,
    { id: "owner-second", branchIds: ["branch-a"], email: "owner-second@example.test", phone: "01055557777", role: "owner" },
  ],
};
const demoteFirstOwner = {
  ...twoOwnerState,
  users: twoOwnerState.users.map((user) => user.id === "owner-a" ? { ...user, role: "coach" } : user),
};
const demoteSecondOwner = {
  ...twoOwnerState,
  users: twoOwnerState.users.map((user) => user.id === "owner-second" ? { ...user, role: "coach" } : user),
};
const mergedOwnerDemotions = mergeRuntimeState(twoOwnerState, demoteFirstOwner, demoteSecondOwner);
assert.throws(
  () => assertNoNewRuntimeStateIntegrityIssues(twoOwnerState, mergedOwnerDemotions),
  (error) =>
    error instanceof RuntimeStateWriteIntegrityError &&
    error.issues.some((issue) => issue.rule === "users.branchOwnerCoverage" && issue.targetId === "branch-a"),
  "write validation must reject merged different-user changes that remove accepted owner coverage",
);
const pendingOwnerDoesNotCover = {
  ...twoOwnerState,
  users: twoOwnerState.users.map((user) =>
    user.id === "owner-second" ? { ...user, invitationStatus: "pending" } : user,
  ),
};
assert.throws(
  () => assertNoNewRuntimeStateIntegrityIssues(pendingOwnerDoesNotCover, {
    ...pendingOwnerDoesNotCover,
    users: pendingOwnerDoesNotCover.users.map((user) =>
      user.id === "owner-a" ? { ...user, role: "coach" } : user,
    ),
  }),
  (error) =>
    error instanceof RuntimeStateWriteIntegrityError &&
    error.issues.some((issue) => issue.rule === "users.branchOwnerCoverage"),
  "a pending owner invitation must not satisfy accepted branch owner coverage",
);
const legacyOwnerlessBranch = {
  ...clean,
  users: clean.users.filter((user) => user.role !== "owner"),
};
assert.deepEqual(
  assertNoNewRuntimeStateIntegrityIssues(legacyOwnerlessBranch, {
    ...legacyOwnerlessBranch,
    branches: [...legacyOwnerlessBranch.branches, { id: "branch-new-ownerless" }],
  }).branches,
  [...legacyOwnerlessBranch.branches, { id: "branch-new-ownerless" }],
  "legacy and newly created ownerless branches must remain compatible until owner coverage is assigned",
);

const emptyMemberAssignment = {
  ...clean,
  members: clean.members.map((member) => ({ ...member, primaryCoachId: "" })),
};
assert(
  inspectRuntimeStateIntegrity(emptyMemberAssignment).some((issue) => issue.rule === "members.primaryCoachId"),
  "an empty member operator assignment must be diagnosed",
);
const emptyAssignmentRepair = reconcileRuntimeStateIntegrity(emptyMemberAssignment, {
  actorUserId: "admin-global",
  createId: createIdSequence("audit-empty-assignment"),
  now: "2026-07-14T00:00:00.000Z",
});
assert.equal(
  emptyAssignmentRepair.db.members[0].primaryCoachId,
  "coach-a",
  "explicit reconciliation must fill an empty assignment with an accepted same-branch operator",
);
assert(
  emptyAssignmentRepair.db.auditLogs.some((log) => log.action === "system.integrity.repair"),
  "repairing an empty assignment must emit an audit record",
);

let auditSequence = 0;
const reconciliation = reconcileRuntimeStateIntegrity(legacy, {
  actorUserId: "admin-global",
  createId: () => `audit-integrity-${++auditSequence}`,
  now: "2026-07-14T00:00:00.000Z",
});
assert.equal(reconciliation.db.members[0].primaryCoachId, "owner-a", "repair must use a same-branch operator");
assert.equal(reconciliation.db.members[0].guardianIds.length, 0, "repair must remove invalid guardian links");
assert.equal(reconciliation.db.classes[0].coachId, "owner-a", "repair must reassign a class to a same-branch operator");
assert.equal(reconciliation.db.attendance.length, legacy.attendance.length, "repair must preserve attendance history");
assert.equal(reconciliation.db.payments.length, legacy.payments.length, "repair must preserve payment history");
assert(reconciliation.repairs.length > 0, "repair must report each persisted change");
assert.equal(
  reconciliation.db.auditLogs.filter((log) => log.action === "system.integrity.repair").length,
  reconciliation.repairs.length,
  "every repair must have an audit record",
);
assert(
  reconciliation.unresolvedIssues.some((issue) => issue.rule === "payments.references"),
  "non-destructive payment findings must remain explicit after repair",
);

const noFallback = {
  ...clean,
  users: clean.users.filter((user) => user.role === "guardian" || user.id === "admin-global"),
};
const noFallbackReconciliation = reconcileRuntimeStateIntegrity(noFallback, {
  actorUserId: "admin-global",
  createId: createIdSequence("audit-no-fallback"),
  now: "2026-07-14T00:00:00.000Z",
});
assert.equal(noFallbackReconciliation.db.members[0].primaryCoachId, "coach-a", "repair must not blank an assignment without a fallback");
assert.equal(noFallbackReconciliation.db.classes[0].coachId, "coach-a", "repair must not blank a required class coach");
assert(
  noFallbackReconciliation.unresolvedIssues.some((issue) => issue.rule === "classes.coachId" && !issue.repairable),
  "missing fallback must remain a blocker",
);
const fallbackEnabled = {
  ...noFallback,
  users: [
    ...noFallback.users,
    { id: "owner-recovery", branchIds: ["branch-a"], phone: "01055556666", role: "owner" },
  ],
};
assert.deepEqual(
  assertNoNewRuntimeStateIntegrityIssues(noFallback, fallbackEnabled),
  fallbackEnabled,
  "adding a valid fallback must not look like a new integrity defect",
);
assert.equal(
  reconcileRuntimeStateIntegrity(fallbackEnabled, {
    actorUserId: "admin-global",
    createId: createIdSequence("audit-recovery-enabled"),
    now: "2026-07-14T00:00:00.000Z",
  }).db.classes[0].coachId,
  "owner-recovery",
  "a newly available fallback must make explicit reconciliation possible",
);
const pendingOperator = {
  ...clean,
  users: [
    ...clean.users,
    { id: "coach-pending", branchIds: ["branch-a"], invitationStatus: "pending", phone: "01077778888", role: "coach" },
  ],
  members: clean.members.map((member) => ({ ...member, primaryCoachId: "coach-pending" })),
  classes: clean.classes.map((session) => ({ ...session, coachId: "coach-pending" })),
};
const pendingRepair = reconcileRuntimeStateIntegrity(pendingOperator, {
  actorUserId: "admin-global",
  createId: createIdSequence("audit-pending-operator"),
  now: "2026-07-14T00:00:00.000Z",
});
assert.equal(pendingRepair.db.members[0].primaryCoachId, "coach-a", "pending invitations must not own member assignments");
assert.equal(pendingRepair.db.classes[0].coachId, "coach-a", "pending invitations must not own class assignments");

console.log(JSON.stringify({
  ok: true,
  checked: [
    "non-mutating runtime validation",
    "structured legacy issue inspection",
    "new integrity damage rejection with legacy compatibility",
    "initial write integrity enforcement",
    "audited explicit reconciliation",
    "attendance and payment history preservation",
    "no empty assignment fallback",
    "repair-enabling operator creation",
    "per-edge partial repair compatibility",
    "per-edge issue count enforcement",
    "empty member assignment diagnosis and audited repair",
    "pending invitation operator exclusion",
    "legacy branch reference diagnosis",
    "empty runtime ID rejection",
    "member deletion audit retention timestamp diagnosis and audited repair",
    "verified admin reconciliation actor",
    "active administrator coverage after concurrent merge",
    "pending administrator exclusion",
    "accepted branch owner coverage after concurrent merge",
    "pending owner exclusion and ownerless branch compatibility",
    "deleted-member race rejection across notes, promotions, tournaments, and QR redemptions",
  ],
}, null, 2));
