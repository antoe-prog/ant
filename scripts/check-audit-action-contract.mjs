import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const domainSource = await readFile("src/lib/domain.ts", "utf8");
const presentationSource = await readFile("src/lib/audit-log-presentation.ts", "utf8");
const backendSchemaSource = await readFile("docs/BACKEND_DB_SCHEMA.md", "utf8");

function extractQuotedValues(source, pattern, label, quotePattern = /"([^"]+)"/g) {
  const block = source.match(pattern)?.[1];
  assert(block, `${label} block must exist`);
  return [...block.matchAll(quotePattern)].map((match) => match[1]);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function assertIncludesAll(actualValues, expectedValues, label) {
  const actual = new Set(actualValues);
  const missing = expectedValues.filter((value) => !actual.has(value));
  assert.deepEqual(missing, [], `${label} is missing: ${missing.join(", ")}`);
}

async function collectFiles(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(entryPath, extension);
      }
      return entry.isFile() && entry.name.endsWith(extension) ? [entryPath] : [];
    }),
  );
  return nested.flat().sort();
}

const domainActions = uniqueSorted(
  extractQuotedValues(
    domainSource,
    /export type AuditAction =([\s\S]*?)\n\nexport type AuditLog/,
    "AuditAction",
  ),
);
const presentationActions = uniqueSorted(
  extractQuotedValues(
    presentationSource,
    /export const auditActionLabels:[\s\S]*?= \{([\s\S]*?)\n\};/,
    "auditActionLabels",
    /^\s*"([^"]+)":/gm,
  ),
);
const documentedActions = uniqueSorted(
  extractQuotedValues(
    backendSchemaSource,
    /CREATE TYPE audit_action AS ENUM \(([\s\S]*?)\);/,
    "documented audit_action",
    /'([^']+)'/g,
  ),
);

const migrationFiles = (await readdir("db/migrations"))
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort();
const migrationSources = await Promise.all(
  migrationFiles.map(async (file) => ({ file, source: await readFile(path.join("db/migrations", file), "utf8") })),
);
const initialAuditActions = migrationSources.flatMap(({ source }) => {
  const block = source.match(/CREATE TYPE audit_action AS ENUM \(([\s\S]*?)\);/)?.[1];
  return block ? [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]) : [];
});
const addedAuditActions = migrationSources.flatMap(({ source }) =>
  [...source.matchAll(/ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '([^']+)'/g)].map((match) => match[1]),
);
const migratedActions = uniqueSorted([...initialAuditActions, ...addedAuditActions]);

const apiFiles = await collectFiles("src/app/api/v1", ".ts");
const apiActionUsages = [];
for (const file of apiFiles) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/\baction:\s*"([a-z][a-z0-9_.]+)"/g)) {
    apiActionUsages.push({ action: match[1], file });
  }
}
const apiActions = uniqueSorted(apiActionUsages.map(({ action }) => action));

assert(domainActions.length > 0, "AuditAction must define at least one action");
assert.deepEqual(presentationActions, domainActions, "shared audit labels must cover AuditAction exactly");
assertIncludesAll(migratedActions, domainActions, "PostgreSQL audit_action migrations");
assertIncludesAll(documentedActions, domainActions, "BACKEND_DB_SCHEMA audit_action enum");
assertIncludesAll(domainActions, apiActions, "AuditAction domain type");

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "AuditAction and shared presentation labels are exhaustive",
        "PostgreSQL audit_action migrations accept every app audit action",
        "backend schema documentation includes every app audit action",
        "API audit action literals are declared by AuditAction",
      ],
      counts: {
        apiActions: apiActions.length,
        documentedActions: documentedActions.length,
        domainActions: domainActions.length,
        migratedActions: migratedActions.length,
        presentationActions: presentationActions.length,
      },
      migrationFiles,
      legacyDatabaseActions: migratedActions.filter((action) => !domainActions.includes(action)),
    },
    null,
    2,
  ),
);
