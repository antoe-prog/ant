import { writeNextBuildReadinessManifest } from "./lib/next-build-readiness.mjs";

const manifest = await writeNextBuildReadinessManifest();

console.log(
  JSON.stringify(
    {
      ok: true,
      manifestPath: manifest.manifestPath,
      buildId: manifest.buildId,
      inputHash: manifest.inputHash,
      inputCount: manifest.inputCount,
    },
    null,
    2,
  ),
);
