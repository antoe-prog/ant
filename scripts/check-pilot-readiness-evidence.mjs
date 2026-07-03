import { readFile } from "node:fs/promises";
import path from "node:path";
import { addReadinessEvidenceIssue, validateReadinessEvidenceCsv } from "./pilot-readiness-evidence-utils.mjs";

const args = process.argv.slice(2);
const filePath = path.resolve(argValue("--file", ".data/pilot-readiness-evidence.csv"));
const phase = argValue("--phase", "all");

function argValue(name, fallback) {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
}

async function main() {
  const blockers = [];
  let csv = "";

  try {
    csv = await readFile(filePath, "utf8");
  } catch (error) {
    addReadinessEvidenceIssue(blockers, "READINESS_EVIDENCE_UNREADABLE", "pilot readiness evidence CSV could not be read.", {
      file: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const validation = validateReadinessEvidenceCsv(csv, { filePath, phase });
  const result = {
    ok: blockers.length === 0 && validation.ok,
    file: validation.file,
    phase: validation.phase,
    statusCounts: validation.statusCounts,
    requiredIds: validation.requiredIds,
    blockers: [...blockers, ...validation.blockers],
    checked: validation.checked,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (result.blockers.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
