import { randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const {
  createRandomPasswordHash,
  defaultPilotPassword,
  generateTemporaryPassword,
  isLegacyDefaultPilotPasswordHash,
  verifyPassword,
} = await import("../src/server/auth-password.ts");

const args = process.argv.slice(2);
const writeRequested = args.includes("--write");
const isolationConfirmed = args.includes("--confirm-isolated-json");

function argValue(name) {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

function fail(message) {
  throw new Error(message);
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function ensureAllowedOutputDirectory(outputPath) {
  const repositoryRoot = await realpath(process.cwd());
  const repositoryRotationRoot = path.join(repositoryRoot, ".data", "local-demo-password-rotations");
  const requestedTemporaryRoot = path.resolve(tmpdir());
  const temporaryRoot = await realpath(requestedTemporaryRoot);
  const outputDirectory = path.dirname(outputPath);
  const requestedInRepositoryRotationRoot = isInside(outputDirectory, repositoryRotationRoot);
  const requestedInTemporaryRoot = isInside(outputDirectory, requestedTemporaryRoot);

  if (!requestedInRepositoryRotationRoot && !requestedInTemporaryRoot) {
    fail("Write output must stay under the OS temporary directory or .data/local-demo-password-rotations.");
  }
  if (requestedInRepositoryRotationRoot) {
    await mkdir(repositoryRotationRoot, { recursive: true, mode: 0o700 });
  }
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const resolvedOutputDirectory = await realpath(outputDirectory);
  const allowedRoots = [temporaryRoot];

  if (requestedInRepositoryRotationRoot) {
    allowedRoots.push(await realpath(repositoryRotationRoot));
  }

  if (!allowedRoots.some((root) => isInside(resolvedOutputDirectory, root))) {
    fail("Write output must stay under the OS temporary directory or .data/local-demo-password-rotations.");
  }

  return resolvedOutputDirectory;
}

async function writeExclusiveJson(filePath, value) {
  const handle = await open(filePath, "wx", 0o600);

  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function validateRuntimeDb(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.users) || !Array.isArray(value.auditLogs)) {
    fail('Runtime JSON must contain "users" and "auditLogs" arrays.');
  }

  return value;
}

function passwordRotationReason(user) {
  if (
    isLegacyDefaultPilotPasswordHash(user.passwordHash) ||
    (user.passwordHash && verifyPassword(defaultPilotPassword, user.passwordHash))
  ) {
    return "legacy-shared-demo";
  }
  if (Object.hasOwn(user, "email") && !user.passwordHash && user.invitationStatus !== "pending") {
    return "missing-email-password";
  }
  return null;
}

function createAuditLog(user, reason, actorUserId, rotatedAt, index) {
  return {
    id: `audit-local-demo-password-${Date.now()}-${index}-${randomBytes(4).toString("hex")}`,
    branchId: user.branchIds?.[0] ?? null,
    actorUserId,
    action: "auth.password_reset.complete",
    targetType: "auth",
    targetId: user.id,
    before: {
      passwordUpdatedAt: user.passwordUpdatedAt ?? null,
      credentialState: reason,
    },
    after: {
      credentialsStoredSeparately: true,
      issuedAt: rotatedAt,
      mode: "generated-local-demo",
      reason: "격리된 로컬 데모 계정 공통 비밀번호 회전",
    },
    result: "success",
    message: "격리된 로컬 데모 계정의 비밀번호를 회전했습니다.",
    createdAt: rotatedAt,
  };
}

async function main() {
  if (args.some((arg) => arg === "--driver=postgres" || arg.startsWith("--postgres-url="))) {
    fail("PostgreSQL and remote runtime sources are not supported by this local-only command.");
  }

  const runtimeArgument = argValue("--runtime");
  if (!runtimeArgument) {
    fail("Provide an explicit local JSON source with --runtime=<file>.");
  }

  const sourcePath = await realpath(path.resolve(runtimeArgument));
  const source = validateRuntimeDb(JSON.parse(await readFile(sourcePath, "utf8")));
  const targets = source.users
    .map((user) => ({ user, reason: passwordRotationReason(user) }))
    .filter((target) => target.reason);
  const summary = {
    ok: true,
    mode: writeRequested ? "write" : "dry-run",
    sourceType: "local-json-file",
    eligibleUsers: targets.length,
    unchangedUsers: source.users.length - targets.length,
    revokedSessions: Array.isArray(source.authSessions) ? source.authSessions.length : 0,
    writesPerformed: false,
  };

  if (!writeRequested) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (!isolationConfirmed) {
    fail("Writing requires --write and --confirm-isolated-json.");
  }

  if (targets.length === 0) {
    fail("No legacy shared demo password hashes were found; no isolated copy was written.");
  }

  const outputArgument = argValue("--out");
  const credentialsArgument = argValue("--credentials");
  if (!outputArgument || !credentialsArgument) {
    fail("Writing requires distinct --out=<isolated.json> and --credentials=<secret.json> files.");
  }

  const outputPath = path.resolve(outputArgument);
  const credentialsPath = path.resolve(credentialsArgument);
  if (path.extname(outputPath).toLowerCase() !== ".json" || path.extname(credentialsPath).toLowerCase() !== ".json") {
    fail("Output and credentials files must use the .json extension.");
  }
  if (sourcePath === outputPath || sourcePath === credentialsPath || outputPath === credentialsPath) {
    fail("Source, isolated output, and credentials paths must all be distinct.");
  }
  if (path.dirname(outputPath) !== path.dirname(credentialsPath)) {
    fail("The credentials file must be stored beside its isolated runtime copy.");
  }

  const outputDirectory = await ensureAllowedOutputDirectory(outputPath);
  const credentialsDirectory = await ensureAllowedOutputDirectory(credentialsPath);
  if (outputDirectory !== credentialsDirectory) {
    fail("The credentials file must be stored beside its isolated runtime copy.");
  }

  const rotatedAt = new Date().toISOString();
  const actorUserId =
    source.users.find((user) => user.role === "admin" && user.invitationStatus !== "pending")?.id ?? targets[0].user.id;
  const credentials = [];
  const passwordsByUserId = new Map();

  for (const { user } of targets) {
    const password = generateTemporaryPassword();
    if (password === defaultPilotPassword) {
      fail("Generated password unexpectedly matched the retired shared demo password.");
    }
    passwordsByUserId.set(user.id, password);
    credentials.push({
      userId: user.id,
      loginIdentifier: user.email ?? user.phone ?? user.id,
      password,
    });
  }

  const nextDb = {
    ...source,
    authSessions: [],
    users: source.users.map((user) => {
      const password = passwordsByUserId.get(user.id);
      return password
        ? {
            ...user,
            passwordHash: createRandomPasswordHash(password),
            passwordResetRequestedAt: undefined,
            passwordUpdatedAt: rotatedAt,
          }
        : user;
    }),
    auditLogs: [
      ...targets.map(({ user, reason }, index) => createAuditLog(user, reason, actorUserId, rotatedAt, index)),
      ...source.auditLogs,
    ],
  };
  const unsafeRemainingUsers = nextDb.users.filter(
    (user) =>
      user.invitationStatus !== "pending" &&
      Object.hasOwn(user, "email") &&
      (!user.passwordHash || verifyPassword(defaultPilotPassword, user.passwordHash)),
  );
  if (unsafeRemainingUsers.length > 0) {
    fail("The isolated runtime still contains email accounts that would use the shared demo password.");
  }

  let credentialsWritten = false;
  let outputWritten = false;
  try {
    await writeExclusiveJson(credentialsPath, {
      version: 1,
      generatedAt: rotatedAt,
      purpose: "local-demo-password-rotation",
      accounts: credentials,
    });
    credentialsWritten = true;
    await writeExclusiveJson(outputPath, nextDb);
    outputWritten = true;
  } catch (error) {
    if (outputWritten) {
      await rm(outputPath, { force: true });
    }
    if (credentialsWritten) {
      await rm(credentialsPath, { force: true });
    }
    throw error;
  }

  process.stdout.write(`${JSON.stringify({ ...summary, writesPerformed: true, rotatedUsers: targets.length }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
