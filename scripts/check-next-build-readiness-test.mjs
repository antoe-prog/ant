import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rename, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertFreshNextBuild,
  getNextBuildDistDir,
  inspectNextBuildReadiness,
  writeNextBuildReadinessManifest,
} from "./lib/next-build-readiness.mjs";

const configuredDistDir = getNextBuildDistDir();
const originalConfiguredDistDir = process.env.FINAL_JUDO_NEXT_DIST_DIR;
delete process.env.FINAL_JUDO_NEXT_DIST_DIR;
const tempDir = await mkdtemp(path.join(tmpdir(), "final-judo-next-build-readiness-"));
const sourcePath = path.join(tempDir, "src", "page.tsx");
const renamedSourcePath = path.join(tempDir, "src", "renamed-page.tsx");
const originalSource = "export default function Page() { return null; }\n";

try {
  await mkdir(path.join(tempDir, "src"), { recursive: true });
  await writeFile(sourcePath, originalSource);

  let report = await inspectNextBuildReadiness(tempDir);
  assert.equal(report.ready, false, "missing .next/BUILD_ID must block next start based checks");
  assert.equal(report.reason, "missing-build");

  await mkdir(path.join(tempDir, ".next"), { recursive: true });
  await writeFile(path.join(tempDir, ".next", "BUILD_ID"), "test-build\n");
  report = await inspectNextBuildReadiness(tempDir);
  assert.equal(report.ready, false, "missing build fingerprint must block next start based checks");
  assert.equal(report.reason, "missing-fingerprint");

  await writeNextBuildReadinessManifest(tempDir);
  report = await assertFreshNextBuild(tempDir);
  assert.equal(report.ready, true, "matching build input fingerprint must pass");

  const originalMtime = new Date("2026-01-01T00:00:00.000Z");
  await writeFile(sourcePath, "export default function Page() { return 'changed'; }\n");
  await utimes(sourcePath, originalMtime, originalMtime);
  report = await inspectNextBuildReadiness(tempDir);
  assert.equal(report.reason, "stale-build", "content changes must be detected even when mtime is preserved");

  await writeFile(sourcePath, originalSource);
  await writeNextBuildReadinessManifest(tempDir);
  await unlink(sourcePath);
  report = await inspectNextBuildReadiness(tempDir);
  assert.equal(report.reason, "stale-build", "source deletion after build must invalidate the fingerprint");

  await writeFile(sourcePath, originalSource);
  await writeNextBuildReadinessManifest(tempDir);
  await rename(sourcePath, renamedSourcePath);
  report = await inspectNextBuildReadiness(tempDir);
  assert.equal(report.reason, "stale-build", "source rename after build must invalidate the fingerprint");
  await rename(renamedSourcePath, sourcePath);

  await writeNextBuildReadinessManifest(tempDir);
  await mkdir(path.join(tempDir, "public"), { recursive: true });
  await writeFile(path.join(tempDir, "public", "brand.txt"), "FINAL\n");
  report = await inspectNextBuildReadiness(tempDir);
  assert.equal(report.reason, "stale-build", "public assets added after build must invalidate the fingerprint");

  await writeNextBuildReadinessManifest(tempDir);
  const initialBuild = await assertFreshNextBuild(tempDir);
  await writeFile(sourcePath, "export default function Page() { return 'during-check'; }\n");
  await writeNextBuildReadinessManifest(tempDir);
  await assert.rejects(
    () => assertFreshNextBuild(tempDir, initialBuild),
    /changed while the next start based check was running/,
    "a build/input change during the gate must not validate the server that was already running",
  );

  await writeFile(path.join(tempDir, ".next", "BUILD_ID"), "different-build\n");
  report = await inspectNextBuildReadiness(tempDir);
  assert.equal(report.reason, "build-fingerprint-mismatch", "BUILD_ID changes without a matching manifest must fail");

  const isolatedDistDir = ".next-isolated";
  await mkdir(path.join(tempDir, isolatedDistDir), { recursive: true });
  await writeFile(path.join(tempDir, isolatedDistDir, "BUILD_ID"), "isolated-build\n");
  const defaultManifestBefore = await readFile(
    path.join(tempDir, ".next", "final-judo-build-readiness.json"),
    "utf8",
  );
  const isolatedManifest = await writeNextBuildReadinessManifest(tempDir, isolatedDistDir);
  assert.equal(
    isolatedManifest.manifestPath,
    path.join(isolatedDistDir, "final-judo-build-readiness.json"),
    "isolated builds must write readiness metadata inside their own dist directory",
  );
  await access(path.join(tempDir, isolatedDistDir, "final-judo-build-readiness.json"));
  assert.equal(
    await readFile(path.join(tempDir, ".next", "final-judo-build-readiness.json"), "utf8"),
    defaultManifestBefore,
    "isolated build readiness must not overwrite the default .next manifest",
  );
  report = await inspectNextBuildReadiness(tempDir, isolatedDistDir);
  assert.equal(report.ready, true, "isolated dist readiness must inspect the matching build artifacts");

  const adminApiCheck = await readFile("scripts/check-admin-user-management-api.mjs", "utf8");
  assert(
    adminApiCheck.includes('import { assertFreshNextBuild } from "./lib/next-build-readiness.mjs";') &&
      adminApiCheck.includes("const initialBuild = await assertFreshNextBuild();") &&
      adminApiCheck.includes("await assertFreshNextBuild(process.cwd(), initialBuild);"),
    "the next start based admin API gate must verify one unchanged build before and after its server assertions",
  );

  const releaseRunner = await readFile("scripts/run-release-checks.mjs", "utf8");
  const buildIndex = releaseRunner.indexOf('["run", "build"]');
  const readinessIndex = releaseRunner.indexOf('["run", "test:next-build-readiness"]');
  const adminApiIndex = releaseRunner.indexOf('["run", "test:admin-user-management-api"]');
  assert(buildIndex >= 0, "release runner must build the current source tree");
  assert(readinessIndex > buildIndex, "release runner must verify build freshness after build");
  assert(adminApiIndex > readinessIndex, "release runner must verify build freshness before the admin API gate");

  const currentBuild = await assertFreshNextBuild(process.cwd(), null, configuredDistDir);

  console.log(
    JSON.stringify(
      {
        ok: true,
        currentBuild,
        checked: [
          "missing production build and fingerprint are rejected",
          "matching content and path fingerprint is accepted",
          "mtime-preserved content changes are rejected",
          "source deletion and rename are rejected",
          "new public assets are rejected",
          "build/input changes during the gate are rejected",
          "BUILD_ID changes without a matching fingerprint are rejected",
          "isolated dist builds keep readiness metadata out of default .next",
          "admin API and release runner integrate the freshness guard in order",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (originalConfiguredDistDir === undefined) {
    delete process.env.FINAL_JUDO_NEXT_DIST_DIR;
  } else {
    process.env.FINAL_JUDO_NEXT_DIST_DIR = originalConfiguredDistDir;
  }
  await rm(tempDir, { force: true, recursive: true });
}
