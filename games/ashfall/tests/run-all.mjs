// 전체 테스트 러너: 단위 테스트 → 헤드리스 런 스모크 → 밸런스 스윕
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const steps = [
  ['단위 테스트', 'unit.mjs', []],
  ['헤드리스 플레이', 'smoke.mjs', []],
  ['밸런스 스윕', 'sweep.mjs', ['8']],
];
let failed = 0;
for (const [label, file, args] of steps) {
  console.log(`\n=== ${label} (${file}) ===`);
  const r = spawnSync(process.execPath, [path.join(dir, file), ...args], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n실패한 단계: ${failed}` : '\n모든 단계 통과');
process.exitCode = failed ? 1 : 0;
