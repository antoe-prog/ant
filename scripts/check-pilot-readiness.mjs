import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultPilotDataFile, parseCsv, validateRows } from "./pilot-data-utils.mjs";

const filePath = resolve(process.argv[2] ?? process.env.PILOT_DATA_FILE ?? defaultPilotDataFile);

async function main() {
  const text = await readFile(filePath, "utf8").catch((error) => {
    throw new Error(`Cannot read pilot data file: ${filePath}. ${error.message}`);
  });
  const parsed = parseCsv(text);
  const { errors, warnings, records } = validateRows(parsed);

  if (errors.length > 0) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          file: filePath,
          errors,
          warnings,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        file: filePath,
        rows: records.length,
        warnings,
        checked: [
          "required CSV headers",
          "branch/user/member/class/notice rows",
          "five pilot roles",
          "coach and guardian name references",
          "membership/payment sample values",
          "class schedule and capacity",
          "sensitive data guardrails",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
