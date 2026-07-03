const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const defaultPilotPassword = "FinalJudoPilot!2026";
const roleEmails = {
  admin: process.env.SMOKE_ADMIN_EMAIL ?? "admin@finaljudo.kr",
  owner: "owner@finaljudo.kr",
};
const rolePasswords = {
  admin: process.env.SMOKE_ADMIN_PASSWORD,
  owner: process.env.SMOKE_OWNER_PASSWORD ?? defaultPilotPassword,
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, init = {}) {
  return fetch(`${baseUrl}${path}`, init).catch((error) => {
    throw new Error(`Cannot reach ${baseUrl}. Start the app with npm run dev before running route smoke. ${error.message}`);
  });
}

async function login(role) {
  const email = roleEmails[role];
  const password = rolePasswords[role];

  assert(email, `${role} login email is not configured`);

  const roleResponse = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const roleCookie = roleResponse.headers.get("set-cookie");

  if (roleResponse.ok && roleCookie) {
    return roleCookie.split(";")[0];
  }

  assert(password, `${role} login password is not configured`);

  const response = await request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = response.headers.get("set-cookie");

  assert(response.ok, `${role} login failed by role or credentials`);
  assert(setCookie, `${role} login did not set session cookie`);

  return setCookie.split(";")[0];
}

async function assertRoute(path, cookie) {
  const response = await request(path, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: "manual",
  });

  assert(response.status === 200, `${path} must return 200, got ${response.status}`);
}

async function assertRouteOrRedirect(path, expectedLocation, cookie) {
  const response = await request(path, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: "manual",
  });
  const location = response.headers.get("location") ?? "";

  if ([307, 308].includes(response.status)) {
    assert(location.includes(expectedLocation), `${path} must redirect to ${expectedLocation}, got ${location}`);
    return;
  }

  assert(response.status === 200, `${path} must return 200 or redirect, got ${response.status}`);
}

async function assertMissingRoute(path, cookie) {
  const response = await request(path, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: "manual",
  });

  assert(response.status === 404, `${path} must stay deleted and return 404, got ${response.status}`);
}

async function run() {
  const adminCookie = await login("admin");
  const ownerCookie = await login("owner");

  for (const path of ["/login", "/signup", "/reset-password"]) {
    await assertRoute(path);
  }

  for (const path of [
    "/app/dashboard",
    "/app/classes",
    "/app/members",
    "/app/payments",
    "/app/notices",
    "/app/notifications",
    "/app/account",
    "/app/admin/branches",
    "/app/admin/users",
    "/app/admin/roles",
    "/app/admin/audit-logs",
    "/app/admin/settings",
  ]) {
    await assertRoute(path, adminCookie);
  }

  await assertRoute("/select-role");

  for (const path of [
    "/app/owner/branches",
    "/app/owner/reports",
  ]) {
    await assertRoute(path, ownerCookie);
  }

  await assertRouteOrRedirect("/dashboard", "/app/dashboard", adminCookie);
  await assertRouteOrRedirect("/classes", "/app/classes", adminCookie);
  await assertRouteOrRedirect("/members", "/app/members", adminCookie);
  await assertRouteOrRedirect("/payments", "/app/payments", adminCookie);
  await assertMissingRoute("/app/requests", adminCookie);
  await assertMissingRoute("/requests", adminCookie);

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        checked: [
          "protected app routes",
          "public auth routes",
          "phone signup entry route",
          "notices/account IA routes",
          "owner dedicated IA routes",
          "admin users/settings IA routes",
          "admin audit log route",
          "notifications alias and select-role route",
          "legacy flat redirects",
          "deleted request routes stay removed",
          "role smoke login with credential fallback",
        ],
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
