import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const workspace = path.resolve(args.workspace ?? ".data");
const outPath = path.resolve(args.out ?? path.join(workspace, "p1-handoff-bundle-manifest.json"));

const topLevelArtifacts = [
  { key: "workspaceSummary", label: "P1 handoff draft workspace summary", path: path.join(workspace, "p1-handoff-draft-workspace.json"), optional: true },
  { key: "p1Readiness", label: "P1 readiness allow-pending report", path: path.join(workspace, "p1-readiness.json"), optional: true },
  { key: "actionChecklistJson", label: "P1 handoff action checklist JSON", path: path.join(workspace, "p1-handoff-action-checklist.json") },
  { key: "actionChecklistCsv", label: "P1 handoff action checklist CSV", path: path.join(workspace, "p1-handoff-action-checklist.csv") },
  { key: "actionChecklistMarkdown", label: "P1 handoff action checklist Markdown", path: path.join(workspace, "p1-handoff-action-checklist.md") },
  { key: "actionBrief", label: "P1 handoff 6-person action brief", path: path.join(workspace, "p1-handoff-action-brief.md") },
  { key: "ownerPackageIndex", label: "P1 handoff owner package index", path: path.join(workspace, "p1-handoff-owner-package-index.md") },
];
const ownerBriefsDir = path.join(workspace, "p1-handoff-owner-briefs");
const ownerPackagesDir = path.join(workspace, "p1-handoff-owner-packages");
const requiredPackageFiles = ["brief.md", "team-agent-prompts.md", "evidence-draft.json", "blocked-report.json", "package-manifest.json"];

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [key, inlineValue] = arg.split("=");
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined && arg.startsWith("--")) {
      index += 1;
    }

    const normalizedKey = key.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[normalizedKey] = value;
  }

  return parsed;
}

function rel(filePath) {
  return path.relative(process.cwd(), filePath) || ".";
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function addBlocker(blockers, code, message, detail = null) {
  blockers.push({ code, message, ...(detail ? { detail } : {}) });
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

async function readArtifact(input, blockers) {
  try {
    const buffer = await readFile(input.path);
    const source = buffer.toString("utf8");

    if (hasSecretLikeSource(source)) {
      addBlocker(blockers, "P1_HANDOFF_BUNDLE_SECRET_LIKE_VALUE", `${input.label} must not include raw secret-like values.`, {
        key: input.key,
        path: rel(input.path),
      });
    }

    return {
      key: input.key,
      label: input.label,
      path: rel(input.path),
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
      source,
    };
  } catch (error) {
    if (!input.optional) {
      addBlocker(blockers, "P1_HANDOFF_BUNDLE_ARTIFACT_MISSING", `${input.label} must exist.`, {
        key: input.key,
        path: rel(input.path),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  }
}

async function listMarkdownFiles(directory, blockers, label) {
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".md")).sort();
    return names.map((name) => path.join(directory, name));
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_BUNDLE_DIRECTORY_MISSING", `${label} directory must exist.`, {
      path: rel(directory),
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function listOwnerPackageDirs(blockers) {
  try {
    const names = (await readdir(ownerPackagesDir)).sort();
    const dirs = [];

    for (const name of names) {
      const dirPath = path.join(ownerPackagesDir, name);
      const itemStat = await stat(dirPath);
      if (itemStat.isDirectory()) {
        dirs.push({ name, path: dirPath });
      }
    }

    return dirs;
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_BUNDLE_DIRECTORY_MISSING", "Owner package directory must exist.", {
      path: rel(ownerPackagesDir),
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function parseJsonArtifact(artifact, blockers, label) {
  if (!artifact) {
    return null;
  }

  try {
    return JSON.parse(artifact.source);
  } catch (error) {
    addBlocker(blockers, "P1_HANDOFF_BUNDLE_JSON_INVALID", `${label} must be valid JSON.`, {
      path: artifact.path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function validateChecklist(checklist, blockers) {
  if (!checklist) {
    return;
  }

  if (!Array.isArray(checklist.checklist) || checklist.checklist.length === 0) {
    addBlocker(blockers, "P1_HANDOFF_BUNDLE_CHECKLIST_EMPTY", "Action checklist must include operator actions.");
  }

  if (!Array.isArray(checklist.teamSummary) || checklist.teamSummary.length === 0) {
    addBlocker(blockers, "P1_HANDOFF_BUNDLE_TEAM_SUMMARY_INCOMPLETE", "Action checklist team summary must include owner groups.", {
      teamSummaryCount: Array.isArray(checklist.teamSummary) ? checklist.teamSummary.length : null,
    });
  }

  const requiredOutputs = ["json", "csv", "markdown", "brief", "ownerPackageIndex", "ownerBriefsDir", "ownerPackagesDir"];
  for (const outputKey of requiredOutputs) {
    if (!text(checklist.outputs?.[outputKey])) {
      addBlocker(blockers, "P1_HANDOFF_BUNDLE_OUTPUT_MISSING", "Action checklist must expose every bundle output path.", {
        outputKey,
      });
    }
  }
}

function validateOwnerPackageIndex(source, ownerPackageDirs, checklist, blockers) {
  if (!source) {
    return;
  }

  for (const { name } of ownerPackageDirs) {
    if (!source.includes(name)) {
      addBlocker(blockers, "P1_HANDOFF_BUNDLE_INDEX_PACKAGE_MISSING", "Owner package index must mention every owner package directory.", {
        packageDir: name,
      });
    }
  }

  const strictCommands = Array.isArray(checklist?.teamSummary)
    ? checklist.teamSummary.flatMap((group) => (Array.isArray(group.strictCommands) ? group.strictCommands : []))
    : [];

  for (const command of strictCommands) {
    if (!source.includes(command)) {
      addBlocker(blockers, "P1_HANDOFF_BUNDLE_INDEX_COMMAND_MISSING", "Owner package index must list every strict handoff command.", {
        command,
      });
    }
  }
}

async function collectOwnerPackageArtifacts(ownerPackageDirs, blockers) {
  const packageArtifacts = [];
  const packageManifests = [];

  for (const ownerPackage of ownerPackageDirs) {
    const files = [];

    for (const fileName of requiredPackageFiles) {
      const artifact = await readArtifact(
        {
          key: `${ownerPackage.name}:${fileName}`,
          label: `${ownerPackage.name} ${fileName}`,
          path: path.join(ownerPackage.path, fileName),
        },
        blockers,
      );

      if (artifact) {
        files.push(artifact);
        packageArtifacts.push(artifact);
      }
    }

    const manifestArtifact = files.find((artifact) => artifact.key.endsWith(":package-manifest.json"));
    const manifest = parseJsonArtifact(manifestArtifact, blockers, `${ownerPackage.name} package manifest`);

    if (manifest) {
      if (manifest.packageDir !== rel(ownerPackage.path)) {
        addBlocker(blockers, "P1_HANDOFF_BUNDLE_PACKAGE_DIR_MISMATCH", "Package manifest must reference its actual package directory.", {
          packageDir: ownerPackage.name,
          manifestPackageDir: manifest.packageDir,
          actualPackageDir: rel(ownerPackage.path),
        });
      }

      if (!Array.isArray(manifest.strictCommands) || manifest.strictCommands.length === 0) {
        addBlocker(blockers, "P1_HANDOFF_BUNDLE_PACKAGE_STRICT_COMMAND_MISSING", "Package manifest must preserve strict commands.", {
          packageDir: ownerPackage.name,
        });
      }

      if (!text(manifest.teamAgentPrompts?.path) || !manifest.teamAgentPrompts.path.endsWith("team-agent-prompts.md")) {
        addBlocker(blockers, "P1_HANDOFF_BUNDLE_PACKAGE_TEAM_PROMPTS_MISSING", "Package manifest must reference the copied P1 team agent prompts.", {
          packageDir: ownerPackage.name,
        });
      }

      packageManifests.push({
        ownerRole: manifest.ownerRole ?? null,
        packageDir: manifest.packageDir ?? rel(ownerPackage.path),
        teamAgentPrompts: manifest.teamAgentPrompts ?? null,
        totalActions: manifest.totalActions ?? null,
        strictCommands: manifest.strictCommands ?? [],
      });
    }
  }

  return { packageArtifacts, packageManifests };
}

const blockers = [];
const topLevelReads = await Promise.all(topLevelArtifacts.map((input) => readArtifact(input, blockers)));
const topLevel = Object.fromEntries(topLevelReads.filter(Boolean).map((artifact) => [artifact.key, artifact]));
const ownerBriefPaths = await listMarkdownFiles(ownerBriefsDir, blockers, "Owner briefs");
const ownerBriefArtifacts = await Promise.all(
  ownerBriefPaths.map((filePath) =>
    readArtifact(
      {
        key: `ownerBrief:${path.basename(filePath)}`,
        label: `owner brief ${path.basename(filePath)}`,
        path: filePath,
      },
      blockers,
    ),
  ),
);
const ownerPackageDirs = await listOwnerPackageDirs(blockers);
const { packageArtifacts, packageManifests } = await collectOwnerPackageArtifacts(ownerPackageDirs, blockers);
const actionChecklist = parseJsonArtifact(topLevel.actionChecklistJson, blockers, "P1 handoff action checklist");
const expectedOwnerGroups = Array.isArray(actionChecklist?.teamSummary) ? actionChecklist.teamSummary.length : 0;

validateChecklist(actionChecklist, blockers);
validateOwnerPackageIndex(topLevel.ownerPackageIndex?.source, ownerPackageDirs, actionChecklist, blockers);

if (expectedOwnerGroups > 0 && ownerBriefArtifacts.filter(Boolean).length !== expectedOwnerGroups) {
  addBlocker(blockers, "P1_HANDOFF_BUNDLE_OWNER_BRIEF_COUNT", "Bundle must include one owner brief Markdown file per checklist owner group.", {
    count: ownerBriefArtifacts.filter(Boolean).length,
    expected: expectedOwnerGroups,
  });
}

if (expectedOwnerGroups > 0 && ownerPackageDirs.length !== expectedOwnerGroups) {
  addBlocker(blockers, "P1_HANDOFF_BUNDLE_OWNER_PACKAGE_COUNT", "Bundle must include one owner package directory per checklist owner group.", {
    count: ownerPackageDirs.length,
    expected: expectedOwnerGroups,
  });
}

const artifacts = [
  ...Object.values(topLevel),
  ...ownerBriefArtifacts.filter(Boolean),
  ...packageArtifacts,
].map((artifact) => ({
  key: artifact.key,
  label: artifact.label,
  path: artifact.path,
  sha256: artifact.sha256,
  sizeBytes: artifact.sizeBytes,
}));
const report = {
  ok: blockers.length === 0,
  releaseDecision: blockers.length === 0 ? "ready" : "blocked",
  p1ReleaseDecision: actionChecklist?.releaseDecision ?? null,
  generatedAt: new Date().toISOString(),
  workspace: rel(workspace),
  checked: [
    "P1 handoff checklist, brief, and package index are present",
    `${expectedOwnerGroups} owner brief Markdown files are present`,
    `${expectedOwnerGroups} owner package directories are present`,
    "each owner package includes brief, evidence draft, blocked report, and manifest",
    "each owner package includes P1 team agent prompts for shared execution context",
    "owner package index references every package and strict handoff command",
    "bundle artifacts do not include raw secret-like values",
    "bundle artifact SHA-256 hashes and byte sizes are recorded",
  ],
  artifacts,
  ownerPackages: packageManifests,
  summary: {
    totalArtifacts: artifacts.length,
    ownerBriefs: ownerBriefArtifacts.filter(Boolean).length,
    ownerPackages: ownerPackageDirs.length,
    actionCount: Array.isArray(actionChecklist?.checklist) ? actionChecklist.checklist.length : 0,
    sizeBytes: artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
  },
  nextActions:
    blockers.length === 0
      ? [
          `Product Lead가 \`p1-handoff-owner-package-index.md\`를 열고 ${ownerPackageDirs.length}개 owner package를 담당자에게 배정합니다.`,
          "각 담당자는 package 안의 `evidence-draft.json`을 실제 운영 증빙으로 채운 뒤 manifest의 strict 명령을 실행합니다.",
        ]
      : ["`npm run p1:handoff-draft -- --out-dir=.data` 또는 `npm run p1:handoff-checklist -- --workspace=.data`로 누락 산출물을 다시 생성합니다."],
  blockers,
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
