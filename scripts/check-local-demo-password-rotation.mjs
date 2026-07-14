import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const {
  createPasswordHash,
  createRandomPasswordHash,
  defaultPilotPassword,
  defaultPilotPasswordHash,
  SharedDemoPasswordError,
  verifyPassword,
} = await import("../src/server/auth-password.ts");

const execFile = promisify(execFileCallback);
const nodeFlags = [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
];
const directory = await mkdtemp(path.join(tmpdir(), "final-judo-local-demo-password-"));
const sourcePath = path.join(directory, "source.json");
const outputPath = path.join(directory, "rotated.json");
const credentialsPath = path.join(directory, "credentials.json");
const alreadyRotatedHash = createRandomPasswordHash("Already-Rotated-Password!2026");
const source = {
  branches: [],
  users: [
    {
      id: "user-admin",
      email: "admin@local.test",
      name: "관리자",
      passwordHash: defaultPilotPasswordHash,
      role: "admin",
      title: "관리자",
      branchIds: ["branch-local"],
    },
    {
      id: "user-coach",
      email: "coach@local.test",
      name: "코치",
      passwordHash: defaultPilotPasswordHash,
      role: "coach",
      title: "코치",
      branchIds: ["branch-local"],
    },
    {
      id: "user-rotated",
      email: "rotated@local.test",
      name: "회전 완료",
      passwordHash: alreadyRotatedHash,
      role: "member",
      title: "회원",
      branchIds: ["branch-local"],
    },
    {
      id: "user-random-salt-shared",
      email: "random-salt@local.test",
      name: "랜덤 솔트 공통 비밀번호",
      passwordHash: createPasswordHash(defaultPilotPassword, "random-legacy-demo-salt"),
      role: "member",
      title: "회원",
      branchIds: ["branch-local"],
    },
    {
      id: "user-missing-hash",
      email: "missing@local.test",
      name: "해시 누락",
      role: "guardian",
      title: "학부모",
      branchIds: ["branch-local"],
    },
    {
      id: "user-pending",
      email: "pending@local.test",
      name: "초대 대기",
      role: "coach",
      title: "코치",
      branchIds: ["branch-local"],
      invitationStatus: "pending",
    },
  ],
  authSessions: [
    {
      id: "session-admin",
      tokenHash: "hash-admin",
      userId: "user-admin",
      createdAt: "2026-07-14T00:00:00.000Z",
      expiresAt: "2026-07-15T00:00:00.000Z",
    },
    {
      id: "session-rotated",
      tokenHash: "hash-rotated",
      userId: "user-rotated",
      createdAt: "2026-07-14T00:00:00.000Z",
      expiresAt: "2026-07-15T00:00:00.000Z",
    },
  ],
  auditLogs: [],
};

await writeFile(sourcePath, `${JSON.stringify(source, null, 2)}\n`, { mode: 0o600 });
const originalSource = await readFile(sourcePath, "utf8");

async function run(args, env = {}) {
  try {
    const result = await execFile(
      process.execPath,
      [...nodeFlags, "scripts/rotate-local-demo-passwords.mjs", ...args],
      { cwd: process.cwd(), env: { ...process.env, ...env }, maxBuffer: 1024 * 1024 },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

assert.throws(
  () => createRandomPasswordHash(defaultPilotPassword),
  SharedDemoPasswordError,
  "new account hashes must reject the retired shared demo password",
);

const dryRun = await run([`--runtime=${sourcePath}`]);
assert.equal(dryRun.code, 0, dryRun.stderr);
assert.deepEqual(JSON.parse(dryRun.stdout), {
  ok: true,
  mode: "dry-run",
  sourceType: "local-json-file",
  eligibleUsers: 4,
  unchangedUsers: 2,
  revokedSessions: 2,
  writesPerformed: false,
});
assert.equal(await readFile(sourcePath, "utf8"), originalSource, "dry-run must not alter the source JSON");
assert(!dryRun.stdout.includes(defaultPilotPassword), "dry-run stdout must not expose the retired password");
assert(!dryRun.stdout.includes(defaultPilotPasswordHash), "dry-run stdout must not expose password hashes");

const missingConfirmation = await run([
  `--runtime=${sourcePath}`,
  "--write",
  `--out=${outputPath}`,
  `--credentials=${credentialsPath}`,
]);
assert.notEqual(missingConfirmation.code, 0, "write must require explicit isolated JSON confirmation");

const inPlaceAttempt = await run([
  `--runtime=${sourcePath}`,
  "--write",
  "--confirm-isolated-json",
  `--out=${sourcePath}`,
  `--credentials=${credentialsPath}`,
]);
assert.notEqual(inPlaceAttempt.code, 0, "source JSON must never be overwritten");

const postgresAttempt = await run([`--runtime=${sourcePath}`, "--driver=postgres"]);
assert.notEqual(postgresAttempt.code, 0, "PostgreSQL mode must be rejected");

const forbiddenDirectory = path.join(process.cwd(), `.local-demo-password-forbidden-${process.pid}`);
const forbiddenAttempt = await run([
  `--runtime=${sourcePath}`,
  "--write",
  "--confirm-isolated-json",
  `--out=${path.join(forbiddenDirectory, "rotated.json")}`,
  `--credentials=${path.join(forbiddenDirectory, "credentials.json")}`,
]);
assert.notEqual(forbiddenAttempt.code, 0, "writes outside approved isolated roots must be rejected");
await assert.rejects(access(forbiddenDirectory), undefined, "a rejected output root must not be created");

const writeRun = await run([
  `--runtime=${sourcePath}`,
  "--write",
  "--confirm-isolated-json",
  `--out=${outputPath}`,
  `--credentials=${credentialsPath}`,
]);
assert.equal(writeRun.code, 0, writeRun.stderr);
const writeSummary = JSON.parse(writeRun.stdout);
assert.equal(writeSummary.writesPerformed, true);
assert.equal(writeSummary.rotatedUsers, 4);
assert.equal(writeSummary.revokedSessions, 2);
assert(!writeRun.stdout.includes(defaultPilotPassword), "write stdout must not expose the retired password");
assert(!writeRun.stdout.includes("passwordHash"), "write stdout must not expose hashes");

const rotated = JSON.parse(await readFile(outputPath, "utf8"));
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
assert.deepEqual(rotated.authSessions, [], "local demo rotation must revoke every existing auth session");
assert.equal(credentials.accounts.length, 4);
assert.equal(new Set(credentials.accounts.map((account) => account.password)).size, 4, "each account must receive a unique password");
assert.equal(rotated.users.find((user) => user.id === "user-rotated").passwordHash, alreadyRotatedHash, "already rotated users must remain unchanged");
assert.equal(rotated.users.find((user) => user.id === "user-pending").passwordHash, undefined, "pending invitations must not receive credentials");

for (const account of credentials.accounts) {
  assert.notEqual(account.password, defaultPilotPassword);
  assert(account.password.length >= 32, "generated local demo passwords must carry at least 128 bits of random hex material");
  const user = rotated.users.find((candidate) => candidate.id === account.userId);
  assert(user, `rotated user ${account.userId} must exist`);
  assert.notEqual(user.passwordHash, defaultPilotPasswordHash);
  assert.equal(verifyPassword(account.password, user.passwordHash), true, "credential must verify against the isolated runtime hash");
}

assert.equal(rotated.auditLogs.length, 4, "each rotation must add an audit record");
assert(rotated.auditLogs.every((log) => log.action === "auth.password_reset.complete"));
const publicArtifacts = `${writeRun.stdout}\n${JSON.stringify(rotated)}`;
for (const account of credentials.accounts) {
  assert(!publicArtifacts.includes(account.password), "raw passwords must remain in the credentials file only");
}

assert.equal((await stat(outputPath)).mode & 0o777, 0o600, "isolated runtime permissions must be owner-only");
assert.equal((await stat(credentialsPath)).mode & 0o777, 0o600, "credentials permissions must be owner-only");
assert.equal(await readFile(sourcePath, "utf8"), originalSource, "write mode must preserve the source JSON");

await rm(directory, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "new password hashes reject the retired shared demo password",
        "fixed and random-salt legacy shared password hashes are both rotated",
        "dry-run performs no writes and emits no secrets",
        "write requires explicit isolated JSON confirmation",
        "PostgreSQL and in-place writes are rejected",
        "isolated runtime and credentials are new owner-only files",
        "per-account passwords are unique, verifiable, and absent from public artifacts",
        "all existing auth sessions are removed from the isolated runtime",
        "already rotated users and the source JSON remain unchanged",
      ],
    },
    null,
    2,
  ),
);
