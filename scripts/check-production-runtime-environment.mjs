import { assessProductionRuntimeEnvironment } from "../src/lib/production-runtime-policy.ts";

const installationMigrationSql = String.raw`\set ON_ERROR_STOP on

\if :{?installation_id}
\else
\echo 'Required psql variable installation_id is missing.'
\quit 3
\endif

-- Existing production state only: restore/import app_runtime_state key mvp before running this migration.
BEGIN;
ALTER TABLE app_runtime_state ADD COLUMN IF NOT EXISTS installation_id text;
SET LOCAL final_judo.expected_installation_id = :'installation_id';

DO $final_judo$
DECLARE
  expected_id text := current_setting('final_judo.expected_installation_id');
  actual_id text;
BEGIN
  IF expected_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$' THEN
    RAISE EXCEPTION 'The installation identity does not satisfy the runtime policy.';
  END IF;

  SELECT installation_id
  INTO actual_id
  FROM app_runtime_state
  WHERE key = 'mvp'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Required runtime state is missing; restore/import it before binding the installation identity.';
  END IF;

  IF actual_id IS NOT NULL AND actual_id <> expected_id THEN
    RAISE EXCEPTION 'Runtime state is already bound to a different installation identity.';
  END IF;

  UPDATE app_runtime_state
  SET installation_id = expected_id
  WHERE key = 'mvp' AND installation_id IS NULL;
END
$final_judo$;

COMMIT;`;

if (process.argv.includes("--print-installation-migration")) {
  console.log(installationMigrationSql);
  process.exit(0);
}

const assessment = assessProductionRuntimeEnvironment(process.env);

if (!assessment.enforced) {
  console.log(JSON.stringify({ ok: true, enforced: false, message: "Production runtime guard skipped outside a production target." }));
  process.exit(0);
}

if (assessment.blockerCodes.length > 0) {
  console.error(
    JSON.stringify({
      ok: false,
      enforced: true,
      blockerCodes: assessment.blockerCodes,
      message: "Deployed runtime requires a persistent PostgreSQL runtime store.",
    }),
  );
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    enforced: true,
    driver: "postgres",
    identityConfigured: true,
    stateKey: assessment.stateKey,
    tableName: assessment.tableName,
  }),
);
