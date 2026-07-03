import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const bundlePath = path.resolve(args.bundle ?? ".data/p1-handoff-bundle-manifest.json");
const outPath = path.resolve(args.out ?? ".data/p1-handoff-dispatch-receipt.json");
const markdownPath = path.resolve(args.markdown ?? path.join(path.dirname(outPath), "p1-handoff-dispatch-receipt.md"));
const csvPath = path.resolve(args.csv ?? path.join(path.dirname(outPath), "p1-handoff-dispatch-receipt.csv"));

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

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packageName(packageDir) {
  return path.basename(packageDir);
}

function findArtifact(bundle, packageDir, fileName) {
  const artifactPath = `${packageDir}/${fileName}`;
  return bundle.artifacts?.find((artifact) => artifact.path === artifactPath) ?? null;
}

function csvEscape(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

function createCsv(receipt) {
  const headers = [
    "packageDir",
    "ownerRole",
    "totalActions",
    "packageManifestSha256",
    "packageManifestSizeBytes",
    "assignedToName",
    "assignedToContact",
    "channel",
    "assignedAt",
    "dueAt",
    "assignmentEvidence",
    "acknowledgementStatus",
    "acknowledgedAt",
    "acknowledgementEvidence",
  ];
  const rows = receipt.ownerPackages.map((ownerPackage) => [
    ownerPackage.packageDir,
    ownerPackage.ownerRole,
    ownerPackage.totalActions,
    ownerPackage.packageManifestSha256,
    ownerPackage.packageManifestSizeBytes,
    ownerPackage.assignment.assignedToName,
    ownerPackage.assignment.assignedToContact,
    ownerPackage.assignment.channel,
    ownerPackage.assignment.assignedAt,
    ownerPackage.assignment.dueAt,
    ownerPackage.assignment.evidence,
    ownerPackage.acknowledgement.status,
    ownerPackage.acknowledgement.acknowledgedAt,
    ownerPackage.acknowledgement.evidence,
  ]);

  return `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function createMarkdown(receipt) {
  const lines = [
    "# P1 Handoff Dispatch Receipt",
    "",
    `- Bundle manifest: \`${receipt.bundleManifest.path}\``,
    `- Bundle SHA-256: \`${receipt.bundleManifest.sha256}\``,
    `- Bundle decision: \`${receipt.bundleManifest.releaseDecision}\``,
    `- P1 release decision: \`${receipt.bundleManifest.p1ReleaseDecision}\``,
    `- Dispatch decision: \`${receipt.releaseDecision}\``,
    "",
    "## Owner Packages",
    "",
    "| Package | Owner role | Actions | Package manifest SHA-256 | Assigned to | Ack status |",
    "| --- | --- | ---: | --- | --- | --- |",
  ];

  for (const ownerPackage of receipt.ownerPackages) {
    lines.push(
      `| \`${packageName(ownerPackage.packageDir)}\` | ${ownerPackage.ownerRole} | ${ownerPackage.totalActions} | \`${ownerPackage.packageManifestSha256}\` | ${ownerPackage.assignment.assignedToName} | ${ownerPackage.acknowledgement.status} |`,
    );
  }

  lines.push(
    "",
    "## Strict Validation",
    "",
    `\`${receipt.outputPaths.csv}\`에 실제 담당자, 전달 채널, ISO 전달/기한 시각, assignment evidence, acknowledgement evidence를 채운 뒤 \`npm run p1:handoff-dispatch:apply-csv -- --receipt=${receipt.outputPaths.receipt} --csv=${receipt.outputPaths.csv} --out=${receipt.outputPaths.completedReceipt} --markdown=${receipt.outputPaths.completedMarkdown}\`를 실행합니다.`,
    `completed receipt가 생성되면 \`npm run p1:handoff-dispatch -- --file=${receipt.outputPaths.completedReceipt} --bundle=${receipt.bundleManifest.path} --out=${receipt.outputPaths.report}\`를 실행해 담당자 배정/acknowledgement 증빙을 strict 검증합니다.`,
    "",
  );

  return `${lines.join("\n")}\n`;
}

const bundleBuffer = await readFile(bundlePath);
const bundle = readJson(bundleBuffer.toString("utf8"), "P1 handoff bundle manifest");
const generatedAt = new Date().toISOString();

const ownerPackages = (bundle.ownerPackages ?? []).map((ownerPackage) => {
  const manifestArtifact = findArtifact(bundle, ownerPackage.packageDir, "package-manifest.json");

  return {
    ownerRole: ownerPackage.ownerRole ?? "TODO owner role",
    packageDir: ownerPackage.packageDir,
    totalActions: ownerPackage.totalActions ?? 0,
    packageManifestSha256: manifestArtifact?.sha256 ?? "TODO package manifest SHA-256",
    packageManifestSizeBytes: manifestArtifact?.sizeBytes ?? 0,
    strictCommands: ownerPackage.strictCommands ?? [],
    assignment: {
      assignedToName: "TODO real owner name",
      assignedToContact: "TODO owner email or messenger handle",
      channel: "TODO delivery channel",
      assignedAt: "TODO ISO timestamp",
      dueAt: "TODO ISO timestamp",
      evidence: "TODO link to ticket, message, or Drive folder",
    },
    acknowledgement: {
      status: "pending",
      acknowledgedAt: "TODO ISO timestamp",
      evidence: "TODO owner acknowledgement evidence",
    },
  };
});

const receipt = {
  schemaVersion: 1,
  generatedAt,
  releaseDecision: "blocked",
  bundleManifest: {
    path: rel(bundlePath),
    sha256: sha256(bundleBuffer),
    sizeBytes: bundleBuffer.byteLength,
    releaseDecision: bundle.releaseDecision ?? null,
    p1ReleaseDecision: bundle.p1ReleaseDecision ?? null,
    generatedAt: bundle.generatedAt ?? null,
  },
  outputPaths: {
    receipt: rel(outPath),
    markdown: rel(markdownPath),
    csv: rel(csvPath),
    completedReceipt: rel(path.join(path.dirname(outPath), "p1-handoff-dispatch-receipt.completed.json")),
    completedMarkdown: rel(path.join(path.dirname(outPath), "p1-handoff-dispatch-receipt.completed.md")),
    report: rel(path.join(path.dirname(outPath), "p1-handoff-dispatch-report.json")),
  },
  ownerPackages,
  summary: {
    ownerPackages: ownerPackages.length,
    totalActions: ownerPackages.reduce((sum, ownerPackage) => sum + ownerPackage.totalActions, 0),
    acknowledged: 0,
  },
  checked: [
    "bundle manifest is ready for dispatch",
    `${ownerPackages.length} owner packages are present`,
    "each owner package has a package manifest digest",
    "each owner has a real assignment, delivery channel, due date, and acknowledgement evidence",
    "raw secret-like values are not written to the dispatch receipt",
  ],
  nextActions: [
    `${rel(csvPath)}에 실제 담당자, 전달 채널, ISO 전달/기한 시각, assignment evidence, acknowledgement evidence를 채웁니다.`,
    `\`npm run p1:handoff-dispatch:apply-csv -- --receipt=${rel(outPath)} --csv=${rel(csvPath)} --out=${rel(path.join(path.dirname(outPath), "p1-handoff-dispatch-receipt.completed.json"))} --markdown=${rel(path.join(path.dirname(outPath), "p1-handoff-dispatch-receipt.completed.md"))}\`를 실행해 completed dispatch receipt를 만듭니다.`,
    `\`npm run p1:handoff-dispatch -- --file=${rel(path.join(path.dirname(outPath), "p1-handoff-dispatch-receipt.completed.json"))} --bundle=${rel(bundlePath)} --out=${rel(path.join(path.dirname(outPath), "p1-handoff-dispatch-report.json"))}\`를 실행한 뒤 strict handoff task를 배정합니다.`,
  ],
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
await mkdir(path.dirname(markdownPath), { recursive: true });
await writeFile(markdownPath, createMarkdown(receipt));
await mkdir(path.dirname(csvPath), { recursive: true });
await writeFile(csvPath, createCsv(receipt));

console.log(JSON.stringify(receipt, null, 2));
