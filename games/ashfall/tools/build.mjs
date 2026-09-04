// ============================================================
// 단일 HTML 빌드.
//
// 소스는 26개 ES 모듈로 나뉘어 있다(그게 옳다). 하지만 공유해서 바로 플레이하려면
// 파일 하나여야 한다. 이 스크립트가 의존성 순서대로 묶어 하나로 만든다.
//
// 번들러를 쓰지 않는 이유: 이 프로젝트는 빌드 도구 없이 돌아가는 것이 전제다.
// 모든 모듈이 정적 named import/export 만 쓰므로 아래 방식으로 충분하다.
//
// 출력:
//   dist/ashfall.html          — 어디서든 열리는 완전한 HTML
//   dist/ashfall.artifact.html — <head>/<body> 없는 본문만 (Artifact 게시용)
//
// 실행: node tools/build.mjs
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/** src 아래 모든 .js 를 모은다 */
function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm;
const files = collect(SRC);

const mods = new Map(); // id -> {id, body, deps:[{id, names}], exports:[]}
for (const abs of files) {
  const id = path.relative(SRC, abs).split(path.sep).join('/');
  let code = fs.readFileSync(abs, 'utf8');
  const deps = [];

  code = code.replace(IMPORT_RE, (_, names, spec) => {
    const depId = path.posix.normalize(path.posix.join(path.posix.dirname(id), spec));
    deps.push({ id: depId, names: names.trim() });
    return `const {${names.trim()}} = __M[${JSON.stringify(depId)}];`;
  });

  // export 이름 수집 후 키워드 제거
  const exports = new Set();
  code = code.replace(/^export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)/gm, (m, a, n) => { exports.add(n); return `${a || ''}function ${n}`; });
  code = code.replace(/^export\s+class\s+([A-Za-z0-9_$]+)/gm, (m, n) => { exports.add(n); return `class ${n}`; });
  code = code.replace(/^export\s+(const|let|var)\s+([A-Za-z0-9_$]+)/gm, (m, k, n) => { exports.add(n); return `${k} ${n}`; });
  code = code.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (m, names) => {
    for (const n of names.split(',')) {
      const t = n.trim();
      if (t) exports.add(t.includes(' as ') ? t.split(' as ')[1].trim() : t);
    }
    return '';
  });

  if (/^export\s/m.test(code)) {
    throw new Error(`${id}: 처리하지 못한 export 구문이 있습니다`);
  }
  mods.set(id, { id, body: code, deps, exports: [...exports] });
}

// 위상 정렬 (순환 참조는 즉시 실패시킨다 — 조용히 깨지는 것보다 낫다)
const order = [];
const state = new Map();
function visit(id, stack = []) {
  if (state.get(id) === 'done') return;
  if (state.get(id) === 'visiting') {
    throw new Error(`순환 import: ${[...stack, id].join(' → ')}`);
  }
  const m = mods.get(id);
  if (!m) throw new Error(`모듈을 찾을 수 없음: ${id}`);
  state.set(id, 'visiting');
  for (const d of m.deps) visit(d.id, [...stack, id]);
  state.set(id, 'done');
  order.push(id);
}
for (const id of mods.keys()) visit(id);

const bundle = order.map((id) => {
  const m = mods.get(id);
  return `// ── ${id} ──────────────────────────────\n` +
    `__M[${JSON.stringify(id)}] = (function () {\n${m.body}\nreturn { ${m.exports.join(', ')} };\n})();`;
}).join('\n\n');

const script = `<script type="module">\n"use strict";\nconst __M = {};\n\n${bundle}\n</script>`;

// index.html 을 뼈대로 삼는다 — 스타일/마크업을 한 곳에서만 관리하기 위해
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const full = html.replace(/<script type="module" src="\.\/src\/main\.js"><\/script>/, script);
if (full === html) throw new Error('index.html 에서 진입 스크립트를 찾지 못했습니다');

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'ashfall.html'), full);

// Artifact 용: <head>/<body> 없이 본문만
const styleM = html.match(/<style>[\s\S]*?<\/style>/);
const titleM = html.match(/<title>[\s\S]*?<\/title>/);
const bodyM = html.match(/<body>([\s\S]*?)<script type="module"/);
if (!styleM || !titleM || !bodyM) throw new Error('index.html 구조를 파싱하지 못했습니다');
const artifact = `${titleM[0]}\n${styleM[0]}\n${bodyM[1].trim()}\n${script}\n`;
fs.writeFileSync(path.join(DIST, 'ashfall.artifact.html'), artifact);

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0);
console.log(`모듈 ${order.length}개 번들 완료`);
console.log(`  dist/ashfall.html          ${kb(path.join(DIST, 'ashfall.html'))} KB`);
console.log(`  dist/ashfall.artifact.html ${kb(path.join(DIST, 'ashfall.artifact.html'))} KB`);
