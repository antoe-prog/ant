import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const receiptPath = path.resolve(args.file ?? ".data/p1-handoff-dispatch-receipt.json");
const outPath = path.resolve(args.out ?? ".data/p1-handoff-dispatch-report.json");

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    parsed[key.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }

  return parsed;
}

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function hasSecretLikeSource(source) {
  return (
    /-----BEGIN[\s\S]*?PRIVATE KEY-----/.test(source) ||
    /\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
}

function hasPlaceholder(value) {
  return !text(value) || /TODO|TBD|placeholder|example|sample|yyyy|미정|예시|샘플|<[^>]+>/i.test(text(value));
}

function evidenceReference(value) {
  return /^(https?:\/\/|s3:\/\/|gs:\/\/|file:\/\/|\/|\.data\/|\.\/)/.test(text(value));
}

function addBlocker(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

function parseJson(source, blockers, label, filePath) {
  try {
    return JSON.parse(source);
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_JSON_INVALID", `${label} must be valid JSON.`, {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function readJsonArtifact(filePath, blockers, label) {
  try {
    const buffer = await readFile(filePath);
    const source = buffer.toString("utf8");

    if (hasSecretLikeSource(source)) {
      addBlocker(blockers, "P1_HANDOFF_DISPATCH_SECRET_LIKE_VALUE", `${label} must not include raw secret-like values.`, {
        path: rel(filePath),
      });
    }

    return {
      buffer,
      json: parseJson(source, blockers, label, filePath),
      path: rel(filePath),
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_ARTIFACT_MISSING", `${label} must exist.`, {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function resolveBundlePath(receipt) {
  if (args.bundle) {
    return path.resolve(args.bundle);
  }

  const receiptBundlePath = text(receipt?.bundleManifest?.path);
  return receiptBundlePath ? path.resolve(receiptBundlePath) : path.resolve(".data/p1-handoff-bundle-manifest.json");
}

function validateTimestamp(value, blockers, code, detail) {
  if (hasPlaceholder(value)) {
    addBlocker(blockers, code, "Dispatch receipt timestamps must be real ISO timestamps.", detail);
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(text(value))) {
    addBlocker(blockers, code, "Dispatch receipt timestamps must use ISO date-time format.", {
      ...detail,
      value,
    });
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    addBlocker(blockers, code, "Dispatch receipt timestamps must be parseable ISO timestamps.", {
      ...detail,
      value,
    });
    return null;
  }

  return parsed;
}

function validateEvidence(value, blockers, code, detail) {
  if (hasPlaceholder(value) || !evidenceReference(value)) {
    addBlocker(blockers, code, "Dispatch receipt evidence must be a real URL or storage path.", {
      ...detail,
      value: value ?? null,
    });
  }
}

function artifactByPath(bundle, artifactPath) {
  return bundle?.artifacts?.find((artifact) => artifact.path === artifactPath) ?? null;
}

function validateOwnerPackage(receiptItem, bundleItem, bundle, blockers) {
  const packageDir = bundleItem.packageDir;
  const packageName = path.basename(packageDir);

  if (!receiptItem) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_OWNER_PACKAGE_MISSING", "Dispatch receipt must include every owner package.", {
      packageDir,
    });
    return;
  }

  if (receiptItem.ownerRole !== bundleItem.ownerRole) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_OWNER_ROLE_MISMATCH", "Dispatch receipt owner role must match bundle manifest.", {
      packageDir,
      expected: bundleItem.ownerRole,
      actual: receiptItem.ownerRole,
    });
  }

  const manifestArtifact = artifactByPath(bundle, `${packageDir}/package-manifest.json`);
  if (!manifestArtifact) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_PACKAGE_MANIFEST_MISSING", "Bundle must include each owner package manifest digest.", {
      packageDir,
    });
  } else if (receiptItem.packageManifestSha256 !== manifestArtifact.sha256) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_PACKAGE_MANIFEST_HASH_MISMATCH", "Dispatch receipt package manifest hash must match bundle manifest.", {
      packageDir,
      expected: manifestArtifact.sha256,
      actual: receiptItem.packageManifestSha256,
    });
  }

  const assignment = receiptItem.assignment ?? {};
  for (const [field, value] of Object.entries({
    assignedToName: assignment.assignedToName,
    assignedToContact: assignment.assignedToContact,
    channel: assignment.channel,
    evidence: assignment.evidence,
  })) {
    if (hasPlaceholder(value)) {
      addBlocker(blockers, "P1_HANDOFF_DISPATCH_ASSIGNMENT_FIELD_MISSING", "Dispatch receipt assignments must use real owner and delivery evidence values.", {
        packageDir,
        packageName,
        field,
      });
    }
  }

  validateEvidence(assignment.evidence, blockers, "P1_HANDOFF_DISPATCH_ASSIGNMENT_EVIDENCE_INVALID", {
    packageDir,
    field: "assignment.evidence",
  });

  const assignedAt = validateTimestamp(assignment.assignedAt, blockers, "P1_HANDOFF_DISPATCH_ASSIGNED_AT_INVALID", {
    packageDir,
    field: "assignedAt",
  });
  const dueAt = validateTimestamp(assignment.dueAt, blockers, "P1_HANDOFF_DISPATCH_DUE_AT_INVALID", {
    packageDir,
    field: "dueAt",
  });

  if (assignedAt !== null && dueAt !== null && dueAt < assignedAt) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_DUE_BEFORE_ASSIGNMENT", "Dispatch receipt due date must be after assignment time.", {
      packageDir,
    });
  }

  const acknowledgement = receiptItem.acknowledgement ?? {};
  if (acknowledgement.status !== "acknowledged") {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_ACKNOWLEDGEMENT_PENDING", "Each owner package must be acknowledged before strict handoff execution.", {
      packageDir,
      status: acknowledgement.status ?? null,
    });
  }

  if (hasPlaceholder(acknowledgement.evidence)) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_ACK_EVIDENCE_MISSING", "Each owner package acknowledgement must include evidence.", {
      packageDir,
    });
  }

  validateEvidence(acknowledgement.evidence, blockers, "P1_HANDOFF_DISPATCH_ACK_EVIDENCE_INVALID", {
    packageDir,
    field: "acknowledgement.evidence",
  });

  const acknowledgedAt = validateTimestamp(acknowledgement.acknowledgedAt, blockers, "P1_HANDOFF_DISPATCH_ACK_AT_INVALID", {
    packageDir,
    field: "acknowledgedAt",
  });

  if (assignedAt !== null && acknowledgedAt !== null && acknowledgedAt < assignedAt) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_ACK_BEFORE_ASSIGNMENT", "Acknowledgement time must be after assignment time.", {
      packageDir,
    });
  }

  if (!Array.isArray(receiptItem.strictCommands) || receiptItem.strictCommands.length === 0) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_STRICT_COMMAND_MISSING", "Dispatch receipt must preserve each owner package strict command.", {
      packageDir,
    });
  }
}

const blockers = [];
const receiptArtifact = await readJsonArtifact(receiptPath, blockers, "P1 handoff dispatch receipt");
const receipt = receiptArtifact?.json ?? null;
const bundlePath = resolveBundlePath(receipt);
const bundleArtifact = await readJsonArtifact(bundlePath, blockers, "P1 handoff bundle manifest");
const bundle = bundleArtifact?.json ?? null;

if (receipt && bundle && bundleArtifact) {
  if (receipt.bundleManifest?.sha256 !== bundleArtifact.sha256) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_BUNDLE_HASH_MISMATCH", "Dispatch receipt bundle hash must match the current bundle manifest.", {
      expected: bundleArtifact.sha256,
      actual: receipt.bundleManifest?.sha256 ?? null,
    });
  }

  if (receipt.bundleManifest?.sizeBytes !== bundleArtifact.sizeBytes) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_BUNDLE_SIZE_MISMATCH", "Dispatch receipt bundle size must match the current bundle manifest.", {
      expected: bundleArtifact.sizeBytes,
      actual: receipt.bundleManifest?.sizeBytes ?? null,
    });
  }
}

if (bundle?.releaseDecision !== "ready") {
  addBlocker(blockers, "P1_HANDOFF_DISPATCH_BUNDLE_NOT_READY", "P1 handoff bundle must be ready before dispatch.", {
    releaseDecision: bundle?.releaseDecision ?? null,
  });
}

const receiptOwnerPackages = Array.isArray(receipt?.ownerPackages) ? receipt.ownerPackages : [];
const bundleOwnerPackages = Array.isArray(bundle?.ownerPackages) ? bundle.ownerPackages : [];
const expectedOwnerPackages = bundleOwnerPackages.length;

if (expectedOwnerPackages > 0 && receiptOwnerPackages.length !== expectedOwnerPackages) {
  addBlocker(blockers, "P1_HANDOFF_DISPATCH_OWNER_PACKAGE_COUNT", "Dispatch receipt must include one row per bundle owner package.", {
    count: receiptOwnerPackages.length,
    expected: expectedOwnerPackages,
  });
}

const seenPackageDirs = new Set();
for (const item of receiptOwnerPackages) {
  if (seenPackageDirs.has(item.packageDir)) {
    addBlocker(blockers, "P1_HANDOFF_DISPATCH_DUPLICATE_PACKAGE", "Dispatch receipt package directories must be unique.", {
      packageDir: item.packageDir,
    });
  }
  seenPackageDirs.add(item.packageDir);
}

for (const bundleItem of bundleOwnerPackages) {
  const receiptItem = receiptOwnerPackages.find((item) => item.packageDir === bundleItem.packageDir);
  validateOwnerPackage(receiptItem, bundleItem, bundle, blockers);
}

const acknowledged = receiptOwnerPackages.filter((item) => item.acknowledgement?.status === "acknowledged").length;
const totalActions = receiptOwnerPackages.reduce((sum, item) => sum + (Number(item.totalActions) || 0), 0);
const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  receipt: receiptArtifact?.path ?? rel(receiptPath),
  bundleManifest: bundleArtifact?.path ?? rel(bundlePath),
  p1ReleaseDecision: bundle?.p1ReleaseDecision ?? null,
  checked: [
    "P1 handoff bundle manifest is ready and unchanged",
    `${expectedOwnerPackages} owner package dispatch rows are present`,
    "package manifest hashes match the bundle manifest",
    "each owner has assignment, channel, due date, and acknowledgement evidence",
    "assignment and acknowledgement evidence is a URL or storage path",
    "dispatch receipt does not include raw secret-like values",
  ],
  summary: {
    ownerPackages: receiptOwnerPackages.length,
    acknowledged,
    totalActions,
  },
  nextActions:
    blockers.length === 0
      ? [
          "Product Lead/QA는 acknowledgement가 완료된 owner package를 각 외부 담당자에게 배정합니다.",
          "각 담당자는 package 증빙을 채우고 receipt에 보존된 strict 명령을 실행합니다.",
        ]
      : [
          "`npm run p1:handoff-dispatch:draft -- --bundle=.data/p1-handoff-bundle-manifest.json --out=.data/p1-handoff-dispatch-receipt.json --markdown=.data/p1-handoff-dispatch-receipt.md`로 dispatch receipt 초안을 만든 뒤 모든 owner 전달/acknowledgement 필드를 채우고 이 strict 검증을 다시 실행합니다.",
        ],
  blockers,
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
