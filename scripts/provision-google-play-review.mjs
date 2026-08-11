import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { googlePlayReviewBranchId } from "../src/lib/google-play-review-access.ts";
import { inspectRuntimeStateIntegrity } from "../src/server/runtime-state-integrity.ts";
import {
  createGooglePlayReviewConsoleEntries,
  createGooglePlayReviewPasswords,
  parseGooglePlayReviewPasswordsReport,
  provisionGooglePlayReviewAccess,
} from "../src/server/google-play-review-provisioning.ts";

const safeIdentifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function argValue(name, fallback = null) {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function fail(message) {
  throw new Error(message);
}

async function main() {
  if (process.argv.some((argument) => argument === "--postgres-url" || argument.startsWith("--postgres-url="))) {
    fail("Database secrets must be supplied through FINAL_JUDO_POSTGRES_URL or DATABASE_URL, never CLI arguments.");
  }

  const apply = process.argv.includes("--apply");
  const connectionString = process.env.FINAL_JUDO_POSTGRES_URL ?? process.env.DATABASE_URL;
  const expectedInstallationId = process.env.FINAL_JUDO_INSTALLATION_ID?.trim();
  const stateKey = process.env.FINAL_JUDO_POSTGRES_STATE_KEY?.trim() || "mvp";
  const table = process.env.FINAL_JUDO_POSTGRES_TABLE?.trim() || "app_runtime_state";
  const origin = argValue("--origin", "https://final-judo.vercel.app");
  const outPath = path.resolve(argValue("--out", ".data/google-play-review-access.json"));
  const credentialsFileValue = process.env.FINAL_JUDO_REVIEW_CREDENTIALS_FILE?.trim() || argValue("--credentials-file");

  if (!connectionString) {
    fail("FINAL_JUDO_POSTGRES_URL or DATABASE_URL is required.");
  }
  if (!expectedInstallationId) {
    fail("FINAL_JUDO_INSTALLATION_ID is required to verify the production runtime identity.");
  }
  if (!safeIdentifierPattern.test(table)) {
    fail("FINAL_JUDO_POSTGRES_TABLE must be a safe SQL identifier.");
  }

  const pool = new Pool({
    application_name: "final-judo-google-play-review-provision",
    connectionString,
    max: 1,
  });
  const client = await pool.connect();
  const credentialsFile = credentialsFileValue ? path.resolve(credentialsFileValue) : null;
  let passwords = createGooglePlayReviewPasswords();

  if (credentialsFile) {
    const credentialsMode = (await stat(credentialsFile)).mode & 0o777;

    if ((credentialsMode & 0o077) !== 0) {
      fail("Review credentials file must not be readable or writable by group or other users.");
    }

    passwords = parseGooglePlayReviewPasswordsReport(
      JSON.parse(await readFile(credentialsFile, "utf8")),
    );
  }
  const entries = createGooglePlayReviewConsoleEntries(passwords);
  const report = {
    generatedAt: new Date().toISOString(),
    productionOrigin: origin,
    loginPath: `${origin.replace(/\/$/, "")}/login`,
    declaration: "These credentials provide access to all functionality available to each listed user role.",
    consoleEntries: entries,
  };
  const temporaryReportPath = `${outPath}.tmp-${process.pid}`;

  try {
    await client.query("BEGIN");
    const stateResult = await client.query(
      `SELECT data, revision, installation_id FROM ${table} WHERE key = $1 FOR UPDATE`,
      [stateKey],
    );
    const stateRow = stateResult.rows[0];

    assert(stateRow, "The configured production runtime state does not exist.");
    assert.equal(
      stateRow.installation_id,
      expectedInstallationId,
      "The production runtime installation identity does not match the approved identity.",
    );

    const currentDb = typeof stateRow.data === "string" ? JSON.parse(stateRow.data) : stateRow.data;
    const nextDb = provisionGooglePlayReviewAccess(currentDb, passwords);
    const currentIssueKeys = new Set(
      inspectRuntimeStateIntegrity(currentDb).map((issue) => `${issue.rule}:${issue.targetId}:${issue.severity}`),
    );
    const newIssues = inspectRuntimeStateIntegrity(nextDb).filter(
      (issue) => !currentIssueKeys.has(`${issue.rule}:${issue.targetId}:${issue.severity}`),
    );

    assert.deepEqual(newIssues, [], "Google Play review provisioning must not introduce runtime integrity issues.");

    if (!apply) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({
        ok: true,
        applied: false,
        branchId: googlePlayReviewBranchId,
        accountCount: entries.length,
        credentialsReused: Boolean(credentialsFile),
        message: "Dry run passed. Re-run with --apply to update the verified production runtime.",
      }, null, 2));
      return;
    }

    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(temporaryReportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryReportPath, 0o600);

    const updateResult = await client.query(
      `UPDATE ${table}
       SET data = $1::jsonb, revision = revision + 1, updated_at = now()
       WHERE key = $2 AND revision = $3 AND installation_id = $4`,
      [JSON.stringify(nextDb), stateKey, stateRow.revision, expectedInstallationId],
    );

    assert.equal(updateResult.rowCount, 1, "The production runtime changed before Google Play review provisioning completed.");
    await client.query("COMMIT");
    await rename(temporaryReportPath, outPath);
    await chmod(outPath, 0o600);

    console.log(JSON.stringify({
      ok: true,
      applied: true,
      branchId: googlePlayReviewBranchId,
      accountCount: entries.length,
      credentialsReused: Boolean(credentialsFile),
      reportPath: outPath,
      credentialsPrinted: false,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await rm(temporaryReportPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    code: "GOOGLE_PLAY_REVIEW_PROVISION_FAILED",
    message: error instanceof Error ? error.message : "Google Play review provisioning failed.",
  }));
  process.exitCode = 1;
});
