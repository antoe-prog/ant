import assert from "node:assert/strict";

const {
  RuntimeStateWriteIntegrityError,
  assertNoNewRuntimeStateIntegrityIssues,
  inspectRuntimeStateIntegrity,
  reconcileRuntimeStateIntegrity,
  validateRuntimeStateIntegrity,
} = await import("../src/server/runtime-state-integrity.ts");

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
    pushSubscriptions: [],
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
assert.throws(
  () => validateRuntimeStateIntegrity({ ...clean, notices: [{ id: "", branchId: "branch-a" }] }),
  /notices.id/,
  "empty collection IDs must be rejected",
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
    "verified admin reconciliation actor",
  ],
}, null, 2));
