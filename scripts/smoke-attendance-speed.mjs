import { resetOwnedSmokeServer } from "./lib/release-smoke-environment.mjs";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const limitMs = Number(process.env.ATTENDANCE_SPEED_LIMIT_MS ?? 30000);
const sessionId = process.env.ATTENDANCE_SPEED_SESSION_ID ?? "class-kids-am";
const selectedBranchId = process.env.ATTENDANCE_SPEED_BRANCH_ID ?? "branch-gangnam";
const skipDevReset = process.env.ATTENDANCE_SPEED_SKIP_DEV_RESET === "1";
const stamp = Date.now();
const coachEmail = "coach@finaljudo.kr";
const coachPassword = process.env.SMOKE_COACH_PASSWORD ?? "FinalJudoPilot!2026";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createClient() {
  let cookie = "";

  return {
    async request(path, init = {}, options = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init.headers ?? {}),
        },
      }).catch((error) => {
        throw new Error(`Cannot reach ${baseUrl}. Start the app with npm run dev before running attendance speed smoke. ${error.message}`);
      });
      const setCookie = response.headers.get("set-cookie");

      if (setCookie) {
        cookie = setCookie.split(";")[0];
      }

      const payload = await response.json().catch(() => ({}));

      if (!options.allowError && !response.ok) {
        throw new Error(`${response.status} ${payload.error?.code ?? ""} ${payload.error?.message ?? ""}`.trim());
      }

      return { response, payload };
    },
  };
}

async function resetDemoData(phase) {
  if (skipDevReset) {
    return;
  }

  const response = await resetOwnedSmokeServer({
    baseUrl,
    env: process.env,
    label: `${phase} attendance speed smoke reset`,
  }).catch((error) => {
    throw new Error(`Cannot reset demo data ${phase} attendance speed smoke. ${error.message}`);
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `Cannot reset demo data ${phase} attendance speed smoke: ${response.status} ${payload.error?.code ?? ""} ${payload.error?.message ?? ""}`.trim(),
    );
  }

  assert(payload.data?.counts?.branches === 2, `demo data reset ${phase} attendance speed smoke did not restore baseline branches`);
}

async function run() {
  const client = createClient();
  let result = await client.request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: coachEmail, password: coachPassword }),
  });

  assert(result.payload.data.user.role === "coach", "coach login failed");

  result = await client.request(`/api/v1/me/bootstrap?selectedBranchId=${selectedBranchId}`);
  const session = result.payload.data.db.classes.find((item) => item.id === sessionId);

  assert(session, `coach session ${sessionId} not found`);
  assert(session.coachId === "user-coach", "selected session must belong to demo coach");
  assert(session.enrolledMemberIds.length > 0, "selected session must have enrolled members");

  const note = `Attendance speed smoke ${stamp}`;
  const items = session.enrolledMemberIds.map((memberId) => ({
    memberId,
    status: "present",
    note,
  }));
  const startedAt = performance.now();

  result = await client.request(`/api/v1/class-sessions/${session.id}/attendance?selectedBranchId=${selectedBranchId}`, {
    method: "PUT",
    body: JSON.stringify({
      items,
      reason: note,
    }),
  });

  const durationMs = Math.round(performance.now() - startedAt);
  const records = result.payload.data.db.attendance.filter(
    (record) => record.sessionId === session.id && session.enrolledMemberIds.includes(record.memberId),
  );
  const auditLogs = result.payload.data.db.auditLogs.filter(
    (log) => log.action === "attendance.update" && log.after?.note === note,
  );

  assert(durationMs <= limitMs, `attendance update took ${durationMs}ms, over ${limitMs}ms limit`);
  assert(records.length >= session.enrolledMemberIds.length, "attendance records missing for enrolled members");
  assert(
    session.enrolledMemberIds.every((memberId) =>
      records.some((record) => record.memberId === memberId && record.status === "present" && record.note === note),
    ),
    "not every enrolled member was marked present with the speed smoke note",
  );
  assert(auditLogs.length >= session.enrolledMemberIds.length, "attendance speed smoke audit logs missing");

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        sessionId: session.id,
        enrolledCount: session.enrolledMemberIds.length,
        durationMs,
        limitMs,
        checked: [
          "coach credential login",
          "coach session scope",
          "whole-class attendance save",
          "30-second processing gate",
          "attendance audit logs",
        ],
      },
      null,
      2,
    ),
  );
}

async function main() {
  await resetDemoData("before");

  try {
    await run();
  } finally {
    await resetDemoData("after");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
