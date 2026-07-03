import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const roots = ["src/app", "src/components"];
const errors = [];
const warnings = [];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
      continue;
    }

    if (/\.(tsx|ts)$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files;
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function stripJsxTags(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasReadableText(inner) {
  const stripped = stripJsxTags(inner);

  return /[\p{L}\p{N}]/u.test(stripped);
}

function hasAccessibleNameAttribute(attrs) {
  return /\baria-label\s*=/.test(attrs) || /\baria-labelledby\s*=/.test(attrs) || /\btitle\s*=/.test(attrs);
}

function isInsideLabel(content, index) {
  const before = content.slice(0, index);
  const lastLabelOpen = before.lastIndexOf("<label");
  const lastLabelClose = before.lastIndexOf("</label>");

  return lastLabelOpen > lastLabelClose;
}

function hasHtmlFor(content, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const htmlForPattern = new RegExp(`htmlFor=(?:["']${escaped}["']|\\{\\\`${escaped}\\\`\\})`);

  return htmlForPattern.test(content);
}

function controlId(attrs) {
  const match = attrs.match(/\bid=(?:["']([^"']+)["']|\{`([^`]+)`\})/);

  return match?.[1] ?? match?.[2] ?? null;
}

function controlType(attrs) {
  const match = attrs.match(/\btype=(?:["']([^"']+)["']|\{["']([^"']+)["']\})/);

  return match?.[1] ?? match?.[2] ?? "";
}

function checkButtons(file, content) {
  const buttonPattern = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let match;

  while ((match = buttonPattern.exec(content))) {
    const [, attrs, inner] = match;

    if (hasAccessibleNameAttribute(attrs) || hasReadableText(inner)) {
      continue;
    }

    errors.push(`${file}:${lineNumber(content, match.index)} native button needs text, aria-label, or aria-labelledby`);
  }
}

function checkControls(file, content) {
  const controlPattern = /<(input|select|textarea)\b([^>]*)/g;
  let match;

  while ((match = controlPattern.exec(content))) {
    const [, tagName, attrs] = match;

    if (controlType(attrs) === "hidden") {
      continue;
    }

    if (hasAccessibleNameAttribute(attrs) || isInsideLabel(content, match.index)) {
      continue;
    }

    const id = controlId(attrs);

    if (id && hasHtmlFor(content, id)) {
      continue;
    }

    errors.push(`${file}:${lineNumber(content, match.index)} ${tagName} needs an associated label or aria label`);
  }
}

function checkImages(file, content) {
  const imagePattern = /<img\b([^>]*)>/g;
  let match;

  while ((match = imagePattern.exec(content))) {
    const attrs = match[1];

    if (!/\balt\s*=/.test(attrs)) {
      errors.push(`${file}:${lineNumber(content, match.index)} img needs alt text`);
    }
  }
}

function checkTabIndex(file, content) {
  const tabIndexPattern = /\btabIndex=\{?["']?([1-9]\d*)["']?\}?/g;
  let match;

  while ((match = tabIndexPattern.exec(content))) {
    errors.push(`${file}:${lineNumber(content, match.index)} avoid positive tabIndex (${match[1]})`);
  }
}

function checkStatusRegions(file, content) {
  if (content.includes("operationError") && !content.includes('role="alert"')) {
    warnings.push(`${file}: operationError appears without role="alert"`);
  }

  if (content.includes("authError") && !content.includes('role="alert"')) {
    warnings.push(`${file}: authError appears without role="alert"`);
  }
}

async function main() {
  const allFiles = (await Promise.all(roots.map((root) => listFiles(root)))).flat();

  for (const absolutePath of allFiles) {
    const file = relative(process.cwd(), absolutePath);
    const content = await readFile(absolutePath, "utf8");

    checkButtons(file, content);
    checkControls(file, content);
    checkImages(file, content);
    checkTabIndex(file, content);
    checkStatusRegions(file, content);
  }

  if (errors.length > 0) {
    console.error(JSON.stringify({ ok: false, errors, warnings }, null, 2));
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        files: allFiles.length,
        warnings,
        checked: [
          "native button accessible names",
          "form control labels",
          "image alt text",
          "positive tabIndex guardrail",
          "basic alert/status region hints",
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
