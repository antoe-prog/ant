import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const expectedRoles = [
  { role: "member", label: "회원", packageId: "kr.co.finaljudo.multigym.member" },
  { role: "guardian", label: "학부모", packageId: "kr.co.finaljudo.multigym.guardian" },
  { role: "coach", label: "코치", packageId: "kr.co.finaljudo.multigym.coach" },
  { role: "owner", label: "대표", packageId: "kr.co.finaljudo.multigym.owner" },
];

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report ?? ".data/mobile-builds/role-apks-20260617/role-apk-build-report.json");
const workspaceRoot = process.cwd();
const reportDir = path.dirname(reportPath);
const blockers = [];

function parseArgs(argv) {
  const parsed = { write: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--write") {
      parsed.write = true;
      continue;
    }

    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    if (key === "--report") {
      parsed.report = value;
    }
  }

  return parsed;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function addBlocker(code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

function isInsideWorkspace(filePath) {
  const relative = path.relative(workspaceRoot, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function workspacePath(filePath) {
  const relative = path.relative(workspaceRoot, filePath);

  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }

  return filePath;
}

function resolveCandidate(rawPath, fallbackBasename = null) {
  const value = text(rawPath);
  const primary = path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
  const fallback = fallbackBasename ? path.join(reportDir, fallbackBasename) : null;
  return { primary, fallback };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeSha256Fingerprint(value) {
  const compact = text(value).replace(/[^0-9a-f]/gi, "").toUpperCase();

  if (compact.length !== 64) {
    return null;
  }

  return compact.match(/.{2}/g).join(":");
}

function signerSha256FromVerificationLines(lines) {
  const line = Array.isArray(lines)
    ? lines.find((item) => text(item).toLowerCase().includes("certificate sha-256 digest"))
    : "";
  const value = text(line).split(":").slice(1).join(":");

  return normalizeSha256Fingerprint(value);
}

function validateHttps(value, code, label) {
  try {
    const url = new URL(text(value));

    if (url.protocol !== "https:") {
      addBlocker(code, `${label} must use HTTPS.`, { value });
      return null;
    }

    return url;
  } catch {
    addBlocker(code, `${label} must be a valid HTTPS URL.`, { value });
    return null;
  }
}

async function readFileWithFallback(rawPath, fallbackBasename, code, label) {
  const { primary, fallback } = resolveCandidate(rawPath, fallbackBasename);

  try {
    return { path: primary, buffer: await readFile(primary), usedFallback: false };
  } catch (primaryError) {
    if (fallback && fallback !== primary) {
      try {
        return { path: fallback, buffer: await readFile(fallback), usedFallback: true };
      } catch {
        // Fall through to the primary error below.
      }
    }

    addBlocker(code, `${label} must be readable.`, {
      path: rawPath ?? null,
      fallback: fallback ?? null,
      error: primaryError instanceof Error ? primaryError.message : String(primaryError),
    });
    return null;
  }
}

async function readJsonWithFallback(rawPath, fallbackBasename, code, label) {
  const entry = await readFileWithFallback(rawPath, fallbackBasename, code, label);

  if (!entry) {
    return null;
  }

  try {
    return { ...entry, json: JSON.parse(entry.buffer.toString("utf8")) };
  } catch (error) {
    addBlocker(code, `${label} must contain valid JSON.`, {
      path: rawPath ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function assertPathInsideWorkspace(rawPath, resolvedPath, key) {
  if (!isInsideWorkspace(resolvedPath)) {
    addBlocker("ANDROID_ROLE_APK_PATH_OUTSIDE_WORKSPACE", "Role APK report paths must point inside the current workspace.", {
      key,
      path: rawPath,
      resolvedPath,
      workspaceRoot,
    });
  }
}

let report = null;
let normalizedReport = null;

try {
  report = JSON.parse(await readFile(reportPath, "utf8"));
  normalizedReport = structuredClone(report);
} catch (error) {
  addBlocker("ANDROID_ROLE_APK_REPORT_UNREADABLE", "Android role APK build report must be readable JSON.", {
    path: reportPath,
    error: error instanceof Error ? error.message : String(error),
  });
}

const roleSummaries = [];

if (report) {
  if (report.ok !== true) {
    addBlocker("ANDROID_ROLE_APK_REPORT_NOT_OK", "Android role APK build report must have ok=true.", { ok: report.ok ?? null });
  }

  const originUrl = validateHttps(report.origin, "ANDROID_ROLE_APK_ORIGIN", "role APK origin");
  const outDirEntry = resolveCandidate(report.outDir, path.basename(reportDir));
  const assetlinksEntry = await readJsonWithFallback(report.assetlinks, "assetlinks.json", "ANDROID_ROLE_APK_ASSETLINKS_UNREADABLE", "role APK assetlinks");
  const assetlinkFingerprintsByPackage = new Map();

  if (outDirEntry.primary && !args.write) {
    assertPathInsideWorkspace(report.outDir, outDirEntry.primary, "outDir");
  }

  if (assetlinksEntry) {
    if (!args.write) {
      assertPathInsideWorkspace(report.assetlinks, assetlinksEntry.path, "assetlinks");
    }

    const assetlinks = assetlinksEntry.json;
    const assetlinkPackages = new Set(
      Array.isArray(assetlinks) ? assetlinks.map((entry) => text(entry?.target?.package_name)).filter(Boolean) : [],
    );
    for (const entry of Array.isArray(assetlinks) ? assetlinks : []) {
      assetlinkFingerprintsByPackage.set(
        text(entry?.target?.package_name),
        new Set((entry?.target?.sha256_cert_fingerprints ?? []).map(normalizeSha256Fingerprint).filter(Boolean)),
      );
    }

    for (const expected of expectedRoles) {
      if (!assetlinkPackages.has(expected.packageId)) {
        addBlocker("ANDROID_ROLE_APK_ASSETLINKS_ROLE_MISSING", "assetlinks.json must include every role package.", {
          role: expected.role,
          packageId: expected.packageId,
        });
      }
    }

    normalizedReport.assetlinks = workspacePath(assetlinksEntry.path);
  }

  if (!Array.isArray(report.outputs)) {
    addBlocker("ANDROID_ROLE_APK_OUTPUTS_INVALID", "Android role APK build report outputs must be an array.");
  } else {
    const outputsByRole = new Map(report.outputs.map((output) => [text(output?.role), output]));

    for (const expected of expectedRoles) {
      const output = outputsByRole.get(expected.role);

      if (!output) {
        addBlocker("ANDROID_ROLE_APK_OUTPUT_MISSING", "Android role APK report must include every required role.", expected);
        continue;
      }

      if (text(output.label) !== expected.label) {
        addBlocker("ANDROID_ROLE_APK_LABEL_MISMATCH", "Role APK label must match the role.", {
          role: expected.role,
          expected: expected.label,
          actual: output.label ?? null,
        });
      }

      if (text(output.packageId) !== expected.packageId) {
        addBlocker("ANDROID_ROLE_APK_PACKAGE_MISMATCH", "Role APK packageId must match the role-specific package.", {
          role: expected.role,
          expected: expected.packageId,
          actual: output.packageId ?? null,
        });
      }

      if (!String(output.startUrl ?? "").startsWith(originUrl?.origin ?? "https://")) {
        addBlocker("ANDROID_ROLE_APK_START_URL_ORIGIN", "Role APK startUrl must use the report origin.", {
          role: expected.role,
          startUrl: output.startUrl ?? null,
          origin: report.origin ?? null,
        });
      }

      validateHttps(output.startUrl, "ANDROID_ROLE_APK_START_URL", `${expected.role} startUrl`);

      const apkEntry = await readFileWithFallback(
        output.apk,
        `final-judo-${expected.role}-${output.versionName}.apk`,
        "ANDROID_ROLE_APK_UNREADABLE",
        `${expected.role} APK`,
      );

      if (!apkEntry) {
        continue;
      }

      if (!args.write) {
        assertPathInsideWorkspace(output.apk, apkEntry.path, `${expected.role}.apk`);
      }

      const actualSize = apkEntry.buffer.byteLength;
      const actualSha = sha256(apkEntry.buffer);
      const signerSha256 = signerSha256FromVerificationLines(output.verification);
      const assetlinkFingerprints = assetlinkFingerprintsByPackage.get(expected.packageId);

      if (Number(output.bytes) !== actualSize) {
        addBlocker("ANDROID_ROLE_APK_SIZE_MISMATCH", "Role APK byte size must match the file.", {
          role: expected.role,
          expected: output.bytes ?? null,
          actual: actualSize,
        });
      }

      if (text(output.sha256).toLowerCase() !== actualSha) {
        addBlocker("ANDROID_ROLE_APK_SHA_MISMATCH", "Role APK SHA-256 must match the file.", {
          role: expected.role,
          expected: output.sha256 ?? null,
          actual: actualSha,
        });
      }

      if (!Array.isArray(output.verification) || !output.verification.some((line) => text(line).includes("Signer #1 certificate SHA-256 digest"))) {
        addBlocker("ANDROID_ROLE_APK_SIGNER_VERIFICATION_MISSING", "Role APK report must include signer certificate verification.", {
          role: expected.role,
        });
      }

      if (!signerSha256) {
        addBlocker("ANDROID_ROLE_APK_SIGNER_SHA_MISSING", "Role APK report must include signer SHA-256 verification output.", {
          role: expected.role,
        });
      } else if (!assetlinkFingerprints?.has(signerSha256)) {
        addBlocker("ANDROID_ROLE_APK_ASSETLINKS_SIGNER_MISMATCH", "assetlinks.json must match the APK signer SHA-256 fingerprint.", {
          role: expected.role,
          packageId: expected.packageId,
          signerSha256,
          assetlinks: [...(assetlinkFingerprints ?? [])],
        });
      }

      output.apk = workspacePath(apkEntry.path);
      output.bytes = actualSize;
      output.sha256 = actualSha;
      roleSummaries.push({
        role: expected.role,
        packageId: expected.packageId,
        apk: output.apk,
        bytes: actualSize,
        sha256: actualSha,
      });
    }

    if (outputsByRole.size !== expectedRoles.length) {
      addBlocker("ANDROID_ROLE_APK_OUTPUT_COUNT", "Android role APK report must contain exactly the four supported role APKs.", {
        expected: expectedRoles.map((role) => role.role),
        actual: [...outputsByRole.keys()],
      });
    }
  }

  normalizedReport.outDir = workspacePath(reportDir);
  normalizedReport.workspaceRoot = workspaceRoot;
  normalizedReport.normalizedAt = new Date().toISOString();
  normalizedReport.releaseDecision = "artifact_ready_release_blocked";
  normalizedReport.releaseBlockers = [
    "stable HTTPS production origin",
    "release signing key/SHA-256 fingerprint",
    "Digital Asset Links deployed on the production origin",
    "Android real-device smoke and release signoff",
  ];
}

if (args.write && normalizedReport) {
  await writeFile(reportPath, `${JSON.stringify(normalizedReport, null, 2)}\n`);
}

const result = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "artifact_ready_release_blocked" : "blocked",
  generatedAt: new Date().toISOString(),
  report: workspacePath(reportPath),
  checked: [
    "role APK build report JSON",
    "four role-specific Android package IDs",
    "current-workspace APK paths",
    "APK byte size and SHA-256 integrity",
    "role start URLs",
    "role assetlinks package coverage",
    "signer certificate verification lines",
    "assetlinks signer certificate match",
    "release caveat separation from Android release handoff",
  ],
  roles: roleSummaries,
  blockers,
  nextActions:
    blockers.length === 0
      ? [
          "Keep these role APKs as installable pilot artifacts.",
          "Do not treat role APK artifact readiness as Play Store release readiness until Android release handoff is strict-ready.",
        ]
      : args.write
        ? ["Fix the listed APK/report blockers, then rerun npm run test:android-role-apks."]
        : ["Run npm run test:android-role-apks -- --write once if the report only contains stale absolute paths."],
};

console.log(JSON.stringify(result, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
