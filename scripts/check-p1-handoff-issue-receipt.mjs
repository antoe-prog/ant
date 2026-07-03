import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const receiptPath = path.resolve(args.file ?? ".data/p1-handoff-issue-registration-receipt.json");
const outPath = path.resolve(args.out ?? ".data/p1-handoff-issue-registration-report.json");

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

function issueDraftManifestReady(manifest) {
  return manifest?.releaseDecision === "ready" && manifest?.publishReady !== false;
}

function blockedIssueDraftNextActions(manifest, issueDraftsPath) {
  const dispatchReceipt = text(manifest?.receipt) || ".data/p1-handoff-dispatch-receipt.json";
  const dispatchDirectory = path.dirname(dispatchReceipt);
  const dispatchCsv = path.join(dispatchDirectory, "p1-handoff-dispatch-receipt.csv");
  const completedReceipt = path.join(dispatchDirectory, "p1-handoff-dispatch-receipt.completed.json");
  const completedMarkdown = path.join(dispatchDirectory, "p1-handoff-dispatch-receipt.completed.md");
  const dispatchReport = path.join(dispatchDirectory, "p1-handoff-dispatch-report.json");

  return [
    "담당자 전달/acknowledgement가 완료될 때까지 GitHub connector 또는 GitHub/Slack 외부 이슈를 등록하지 않습니다.",
    `먼저 \`${dispatchCsv}\`에 실제 담당자, 전달 채널, due date, assignment evidence, acknowledgement evidence를 채운 뒤 \`npm run p1:handoff-dispatch:apply-csv -- --receipt=${dispatchReceipt} --csv=${dispatchCsv} --out=${completedReceipt} --markdown=${completedMarkdown}\`를 실행합니다.`,
    `completed dispatch receipt를 \`npm run p1:handoff-dispatch -- --file=${completedReceipt} --bundle=.data/p1-handoff-bundle-manifest.json --out=${dispatchReport}\`로 검증합니다.`,
    `그 다음 \`npm run p1:handoff-issues:draft -- --receipt=${completedReceipt} --out-dir=${rel(path.dirname(issueDraftsPath))}\`를 다시 실행해 \`publishReady=true\`를 확인합니다.`,
  ];
}

function hasPlaceholder(value) {
  return !text(value) || /TODO|TBD|placeholder|example|sample|yyyy|미정|예시|샘플|<[^>]+>/i.test(text(value));
}

function hasSecretLikeSource(source) {
  return (
    /-----BEGIN[\s\S]*?PRIVATE KEY-----/.test(source) ||
    /\b(sk|pk|whsec)_(live|test)_[A-Za-z0-9_=-]+/.test(source) ||
    /FinalJudoPilot![A-Za-z0-9!@#$%^&*()_+=-]*/.test(source)
  );
}

function addBlocker(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
}

function parseJson(source, blockers, label, filePath) {
  try {
    return JSON.parse(source);
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_JSON_INVALID", `${label} must be valid JSON.`, {
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
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_SECRET_LIKE_VALUE", `${label} must not include raw secret-like values.`, {
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
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_ARTIFACT_MISSING", `${label} must exist.`, {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function readMarkdownArtifact(filePath, blockers, label) {
  try {
    const buffer = await readFile(filePath);
    const source = buffer.toString("utf8");

    if (hasSecretLikeSource(source)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_SECRET_LIKE_VALUE", `${label} must not include raw secret-like values.`, {
        path: rel(filePath),
      });
    }

    return {
      path: rel(filePath),
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    };
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_DRAFT_MISSING", `${label} must exist.`, {
      path: rel(filePath),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function resolveIssueDraftsPath(receipt) {
  if (args.issueDrafts) {
    return path.resolve(args.issueDrafts);
  }

  const receiptIssueDraftPath = text(receipt?.issueDraftManifest?.path);
  return receiptIssueDraftPath ? path.resolve(receiptIssueDraftPath) : path.resolve(".data/p1-handoff-issue-drafts/issue-drafts.json");
}

function validateTimestamp(value, blockers, code, detail) {
  if (hasPlaceholder(value)) {
    addBlocker(blockers, code, "Issue registration timestamps must be real ISO timestamps.", detail);
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}T/.test(text(value))) {
    addBlocker(blockers, code, "Issue registration timestamps must use ISO date-time format.", {
      ...detail,
      value,
    });
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    addBlocker(blockers, code, "Issue registration timestamps must be parseable ISO timestamps.", {
      ...detail,
      value,
    });
    return null;
  }

  return parsed;
}

function validateHttpsUrl(value, blockers, code, detail) {
  if (hasPlaceholder(value)) {
    addBlocker(blockers, code, "Issue registration URL must be a real HTTPS permalink.", detail);
    return;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      addBlocker(blockers, code, "Issue registration URL must use HTTPS.", {
        ...detail,
        value,
      });
    }
  } catch {
    addBlocker(blockers, code, "Issue registration URL must be parseable.", {
      ...detail,
      value,
    });
  }
}

function missingLabels(expectedLabels, actualLabels) {
  const actual = new Set(Array.isArray(actualLabels) ? actualLabels : []);
  return (Array.isArray(expectedLabels) ? expectedLabels : []).filter((label) => !actual.has(label));
}

async function validateRegistration(issueDraft, registration, blockers) {
  const packageDir = issueDraft.packageDir;

  if (!registration) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_REGISTRATION_MISSING", "Issue registration receipt must include every issue draft.", {
      packageDir,
    });
    return;
  }

  if (registration.ownerRole !== issueDraft.ownerRole) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_OWNER_ROLE_MISMATCH", "Issue registration owner role must match the issue draft manifest.", {
      packageDir,
      expected: issueDraft.ownerRole,
      actual: registration.ownerRole,
    });
  }

  if (registration.title !== issueDraft.title) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_TITLE_MISMATCH", "Issue registration title must match the issue draft manifest.", {
      packageDir,
      expected: issueDraft.title,
      actual: registration.title,
    });
  }

  if (registration.issueDraft?.path !== issueDraft.path) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_DRAFT_PATH_MISMATCH", "Issue registration draft path must match the issue draft manifest.", {
      packageDir,
      expected: issueDraft.path,
      actual: registration.issueDraft?.path ?? null,
    });
  }

  const draftArtifact = await readMarkdownArtifact(path.resolve(issueDraft.path), blockers, "P1 handoff issue draft Markdown");
  if (draftArtifact) {
    if (registration.issueDraft?.bodySha256 !== draftArtifact.sha256) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_DRAFT_HASH_MISMATCH", "Issue registration draft hash must match the current Markdown draft.", {
        packageDir,
        expected: draftArtifact.sha256,
        actual: registration.issueDraft?.bodySha256 ?? null,
      });
    }

    if (registration.issueDraft?.sizeBytes !== draftArtifact.sizeBytes) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_DRAFT_SIZE_MISMATCH", "Issue registration draft size must match the current Markdown draft.", {
        packageDir,
        expected: draftArtifact.sizeBytes,
        actual: registration.issueDraft?.sizeBytes ?? null,
      });
    }
  }

  if (!Array.isArray(registration.issueDraft?.strictCommands) || registration.issueDraft.strictCommands.length === 0) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_STRICT_COMMAND_MISSING", "Issue registration must preserve strict validation commands.", {
      packageDir,
    });
  }

  if ((Number(registration.issueDraft?.totalActions) || 0) !== (Number(issueDraft.totalActions) || 0)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_ACTION_COUNT_MISMATCH", "Issue registration action count must match the issue draft manifest.", {
      packageDir,
      expected: Number(issueDraft.totalActions) || 0,
      actual: Number(registration.issueDraft?.totalActions) || 0,
    });
  }

  const external = registration.external ?? {};
  for (const [field, value] of Object.entries({
    system: external.system,
    id: external.id,
    postedBy: external.postedBy,
    assignee: external.assignee,
    evidence: external.evidence,
  })) {
    if (hasPlaceholder(value)) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_EXTERNAL_FIELD_MISSING", "Issue registration external fields must use real posting evidence values.", {
        packageDir,
        field,
      });
    }
  }

  validateHttpsUrl(external.url, blockers, "P1_HANDOFF_ISSUE_RECEIPT_EXTERNAL_URL_INVALID", {
    packageDir,
    field: "external.url",
  });

  if (external.bodySha256 !== registration.issueDraft?.bodySha256) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_BODY_HASH_MISMATCH", "External issue body hash must match the generated Markdown draft hash.", {
      packageDir,
      expected: registration.issueDraft?.bodySha256 ?? null,
      actual: external.bodySha256 ?? null,
    });
  }

  const missing = missingLabels(issueDraft.labels, external.labels);
  if (missing.length > 0) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_LABELS_MISSING", "External issue labels must include the generated issue draft labels.", {
      packageDir,
      missing,
    });
  }

  const postedAt = validateTimestamp(external.postedAt, blockers, "P1_HANDOFF_ISSUE_RECEIPT_POSTED_AT_INVALID", {
    packageDir,
    field: "external.postedAt",
  });

  const acknowledgement = registration.acknowledgement ?? {};
  if (acknowledgement.status !== "acknowledged") {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_ACK_PENDING", "Issue registration must be acknowledged by the external owner.", {
      packageDir,
      status: acknowledgement.status ?? null,
    });
  }

  if (hasPlaceholder(acknowledgement.evidence)) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_ACK_EVIDENCE_MISSING", "Issue registration acknowledgement must include evidence.", {
      packageDir,
    });
  }

  const acknowledgedAt = validateTimestamp(
    acknowledgement.acknowledgedAt,
    blockers,
    "P1_HANDOFF_ISSUE_RECEIPT_ACK_AT_INVALID",
    {
      packageDir,
      field: "acknowledgement.acknowledgedAt",
    },
  );

  if (postedAt !== null && acknowledgedAt !== null && acknowledgedAt < postedAt) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_ACK_BEFORE_POST", "Issue acknowledgement time must be after posting time.", {
      packageDir,
    });
  }
}

const blockers = [];
const receiptArtifact = await readJsonArtifact(receiptPath, blockers, "P1 handoff issue registration receipt");
const receipt = receiptArtifact?.json ?? null;
const issueDraftsPath = resolveIssueDraftsPath(receipt);
const issueResultsPath = path.join(path.dirname(issueDraftsPath), "github-issue-create-results.json");
const issueResultsCsvPath = path.join(path.dirname(issueDraftsPath), "github-issue-create-results.csv");
const connectorResponsesPath = path.join(path.dirname(issueDraftsPath), "github-connector-issue-responses.json");
const issueDraftsArtifact = await readJsonArtifact(issueDraftsPath, blockers, "P1 handoff issue draft manifest");
const issueDrafts = issueDraftsArtifact?.json ?? null;

if (receipt && issueDraftsArtifact) {
  if (receipt.issueDraftManifest?.sha256 !== issueDraftsArtifact.sha256) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_MANIFEST_HASH_MISMATCH", "Issue registration receipt manifest hash must match the current issue draft manifest.", {
      expected: issueDraftsArtifact.sha256,
      actual: receipt.issueDraftManifest?.sha256 ?? null,
    });
  }

  if (receipt.issueDraftManifest?.sizeBytes !== issueDraftsArtifact.sizeBytes) {
    addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_MANIFEST_SIZE_MISMATCH", "Issue registration receipt manifest size must match the current issue draft manifest.", {
      expected: issueDraftsArtifact.sizeBytes,
      actual: receipt.issueDraftManifest?.sizeBytes ?? null,
    });
  }
}

if (issueDrafts?.releaseDecision !== "ready") {
  addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_DRAFTS_NOT_READY", "Issue registration receipt requires ready issue drafts.", {
    releaseDecision: issueDrafts?.releaseDecision ?? null,
  });
}

if (issueDrafts?.publishReady === false) {
  addBlocker(
    blockers,
    "P1_HANDOFF_ISSUE_RECEIPT_DRAFTS_NOT_PUBLISH_READY",
    "Issue registration receipt requires publish-ready issue drafts.",
    {
      publishReady: false,
      receipt: issueDrafts.receipt ?? null,
    },
  );
}

const issueDraftRows = Array.isArray(issueDrafts?.issueDrafts) ? issueDrafts.issueDrafts : [];
const registrations = Array.isArray(receipt?.registrations) ? receipt.registrations : [];
const expectedRegistrations = issueDraftRows.length;
const issueDraftsReady = issueDraftManifestReady(issueDrafts);

if (issueDraftRows.length === 0) {
  addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_DRAFT_COUNT", "Issue registration receipt requires issue drafts.", {
    count: issueDraftRows.length,
  });
}

if (issueDraftsReady && expectedRegistrations > 0 && registrations.length !== expectedRegistrations) {
  addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_REGISTRATION_COUNT", "Issue registration receipt requires one registration per issue draft.", {
    count: registrations.length,
    expected: expectedRegistrations,
  });
}

if (issueDraftsReady) {
  const packageDirs = new Map();
  const externalUrls = new Map();
  const externalKeys = new Map();

  for (const registration of registrations) {
    const packageDir = text(registration.packageDir);
    const packageMatches = packageDirs.get(packageDir) ?? [];
    packageMatches.push(packageDir);
    packageDirs.set(packageDir, packageMatches);

    const externalUrl = text(registration.external?.url);
    if (externalUrl && !hasPlaceholder(externalUrl)) {
      const urlMatches = externalUrls.get(externalUrl) ?? [];
      urlMatches.push(packageDir);
      externalUrls.set(externalUrl, urlMatches);
    }

    const externalSystem = text(registration.external?.system);
    const externalId = text(registration.external?.id);
    if (externalSystem && externalId && !hasPlaceholder(externalSystem) && !hasPlaceholder(externalId)) {
      const externalKey = `${externalSystem}:${externalId}`;
      const keyMatches = externalKeys.get(externalKey) ?? [];
      keyMatches.push(packageDir);
      externalKeys.set(externalKey, keyMatches);
    }
  }

  for (const [packageDir, matches] of packageDirs.entries()) {
    if (packageDir && matches.length > 1) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_DUPLICATE_PACKAGE", "Issue registration package directories must be unique.", {
        packageDir,
        count: matches.length,
      });
    }
  }

  for (const [externalUrl, packageDirsWithUrl] of externalUrls.entries()) {
    if (packageDirsWithUrl.length > 1) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_DUPLICATE_EXTERNAL_URL", "Issue registration external URLs must be unique.", {
        externalUrl,
        count: packageDirsWithUrl.length,
        packageDirs: packageDirsWithUrl,
      });
    }
  }

  for (const [externalKey, packageDirsWithKey] of externalKeys.entries()) {
    if (packageDirsWithKey.length > 1) {
      addBlocker(blockers, "P1_HANDOFF_ISSUE_RECEIPT_DUPLICATE_EXTERNAL_ID", "Issue registration external IDs must be unique per system.", {
        externalKey,
        count: packageDirsWithKey.length,
        packageDirs: packageDirsWithKey,
      });
    }
  }

  for (const issueDraft of issueDraftRows) {
    const registration = registrations.find((item) => item.packageDir === issueDraft.packageDir);
    await validateRegistration(issueDraft, registration, blockers);
  }
}

const registered = registrations.filter((item) => !hasPlaceholder(item.external?.url)).length;
const acknowledged = registrations.filter((item) => item.acknowledgement?.status === "acknowledged").length;
const totalActions = registrations.reduce((sum, registration) => sum + (Number(registration.issueDraft?.totalActions) || 0), 0);
const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  generatedAt: new Date().toISOString(),
  receipt: receiptArtifact?.path ?? rel(receiptPath),
  issueDraftManifest: issueDraftsArtifact?.path ?? rel(issueDraftsPath),
  checked: [
    "issue draft manifest is ready and unchanged",
    `${expectedRegistrations} owner issue registrations are present`,
    "external issue body hash matches the generated Markdown draft",
    "external URL, assignee, labels, and acknowledgement evidence are filled",
    "issue registration receipt does not include raw secret-like values",
  ],
  summary: {
    issueDrafts: issueDraftRows.length,
    registrations: registrations.length,
    registered,
    acknowledged,
    totalActions,
  },
  nextActions:
    blockers.length === 0
      ? [
          "Product Lead/QA는 외부 이슈 URL을 P1 운영 handoff 추적판으로 사용합니다.",
          "각 담당자는 이슈 체크리스트를 따라 strict 명령 출력과 증빙을 첨부한 뒤 P1 readiness에 반영합니다.",
        ]
      : !issueDraftsReady
        ? blockedIssueDraftNextActions(issueDrafts, issueDraftsPath)
      : [
          `GitHub connector \`_create_issue\`를 사용했다면 반환된 issue snapshot을 \`${rel(connectorResponsesPath)}\`에 저장하고 \`npm run p1:handoff-issue-receipt:connector-results -- --issue-drafts=${rel(issueDraftsPath)} --responses=${rel(connectorResponsesPath)} --out=${rel(issueResultsPath)}\`를 실행한 뒤 \`npm run p1:handoff-issue-receipt:apply-results -- --issue-drafts=${rel(issueDraftsPath)} --results=${rel(issueResultsPath)} --out=${receiptArtifact?.path ?? rel(receiptPath)} --markdown=${rel(path.join(path.dirname(receiptPath), "p1-handoff-issue-registration-receipt.md"))}\`를 실행합니다.`,
          `CSV로 등록 결과를 회수한다면 \`github-issue-create-results.template.csv\`를 복사해 \`${rel(issueResultsCsvPath)}\`를 채우고 \`npm run p1:handoff-issue-receipt:apply-results-csv -- --issue-drafts=${rel(issueDraftsPath)} --csv=${rel(issueResultsCsvPath)} --out=${receiptArtifact?.path ?? rel(receiptPath)} --markdown=${rel(path.join(path.dirname(receiptPath), "p1-handoff-issue-registration-receipt.md"))}\`를 실행한 뒤 strict 검증을 다시 실행합니다.`,
          `구조화 연동이 JSON을 내보낸다면 \`github-issue-create-results.template.json\` 기준으로 \`${rel(issueResultsPath)}\`를 채우고 \`npm run p1:handoff-issue-receipt:apply-results -- --issue-drafts=${rel(issueDraftsPath)} --results=${rel(issueResultsPath)} --out=${receiptArtifact?.path ?? rel(receiptPath)} --markdown=${rel(path.join(path.dirname(receiptPath), "p1-handoff-issue-registration-receipt.md"))}\`를 실행한 뒤 strict 검증을 다시 실행합니다.`,
          `GitHub CLI가 아닌 외부 workflow를 쓴다면 \`npm run p1:handoff-issue-receipt:draft -- --issue-drafts=${rel(issueDraftsPath)} --out=${receiptArtifact?.path ?? rel(receiptPath)}\`로 receipt 초안을 만들고 모든 TODO를 실제 GitHub/Slack 등록 URL, 담당자, acknowledgement 증빙으로 교체한 뒤 strict 검증을 다시 실행합니다.`,
        ],
  blockers,
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
