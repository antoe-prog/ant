import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const backlogPath = "docs/IMPLEMENTATION_BACKLOG.md";
const source = readFileSync(backlogPath, "utf8");
const lines = source.split(/\r?\n/);
const allowedStatuses = new Set(["완료", "대기", "진행", "진행중", "보류"]);
const items = [];
let currentSection = null;

for (const [index, line] of lines.entries()) {
  const sectionMatch = line.match(/^## (P\d+-\d+)\./);

  if (sectionMatch) {
    currentSection = sectionMatch[1];
    continue;
  }

  const rowMatch = line.match(/^\| (P\d+-\d+\.\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/);

  if (!rowMatch) {
    continue;
  }

  const [, id, title, acceptanceCriteria, status] = rowMatch;
  const [, phase, group, item] = id.match(/^(P\d+)-(\d+)\.(\d+)$/);
  const expectedSection = `${phase}-${group}`;

  items.push({
    id,
    title: title.trim(),
    acceptanceCriteria: acceptanceCriteria.trim(),
    status: status.trim(),
    lineNumber: index + 1,
    section: currentSection,
    expectedSection,
    groupKey: `${phase}-${group}`,
    itemNumber: Number(item),
  });
}

assert(items.length > 0, `${backlogPath} must contain implementation backlog rows`);

const duplicateIds = [];
const seenIds = new Map();

for (const item of items) {
  const first = seenIds.get(item.id);

  if (first) {
    duplicateIds.push(`${item.id} at lines ${first.lineNumber}, ${item.lineNumber}`);
    continue;
  }

  seenIds.set(item.id, item);
}

assert.equal(duplicateIds.length, 0, `Duplicate backlog IDs found:\n${duplicateIds.join("\n")}`);

for (const item of items) {
  assert.equal(
    item.section,
    item.expectedSection,
    `${item.id} at line ${item.lineNumber} is under ${item.section ?? "no section"}, expected ${item.expectedSection}`,
  );
  assert(item.title.length > 0, `${item.id} at line ${item.lineNumber} must have a title`);
  assert(item.acceptanceCriteria.length > 0, `${item.id} at line ${item.lineNumber} must have acceptance criteria`);
  assert(
    allowedStatuses.has(item.status),
    `${item.id} at line ${item.lineNumber} has unsupported status ${item.status}`,
  );
}

const itemsByGroup = new Map();

for (const item of items) {
  const groupItems = itemsByGroup.get(item.groupKey) ?? [];
  groupItems.push(item);
  itemsByGroup.set(item.groupKey, groupItems);
}

const sequenceErrors = [];

for (const [groupKey, groupItems] of itemsByGroup.entries()) {
  const sorted = [...groupItems].sort((a, b) => a.itemNumber - b.itemNumber);

  for (const [index, item] of sorted.entries()) {
    const expected = index + 1;

    if (item.itemNumber !== expected) {
      sequenceErrors.push(`${groupKey} expected item ${expected}, found ${item.id} at line ${item.lineNumber}`);
    }
  }
}

assert.equal(sequenceErrors.length, 0, `Backlog item sequence errors found:\n${sequenceErrors.join("\n")}`);

const nextActionHeading = "## 바로 다음 작업";
const nextActionStartIndex = lines.findIndex((line) => line.trim() === nextActionHeading);

assert.notEqual(nextActionStartIndex, -1, `${backlogPath} must contain ${nextActionHeading}`);

const nextActionEndIndex = lines.findIndex((line, index) => index > nextActionStartIndex && /^## /.test(line));
const nextActionLines = lines.slice(
  nextActionStartIndex + 1,
  nextActionEndIndex === -1 ? lines.length : nextActionEndIndex,
);
const nextActionItems = [];

for (const [index, line] of nextActionLines.entries()) {
  const itemMatch = line.match(/^(\d+)\. /);

  if (!itemMatch) {
    continue;
  }

  nextActionItems.push({
    lineNumber: nextActionStartIndex + index + 2,
    number: Number(itemMatch[1]),
  });
}

assert(nextActionItems.length > 0, `${backlogPath} ${nextActionHeading} must contain ordered next actions`);

const nextActionSequenceErrors = [];

for (const [index, item] of nextActionItems.entries()) {
  const expected = index + 1;

  if (item.number !== expected) {
    nextActionSequenceErrors.push(`expected next action ${expected}, found ${item.number} at line ${item.lineNumber}`);
  }
}

assert.equal(
  nextActionSequenceErrors.length,
  0,
  `Backlog next action sequence errors found:\n${nextActionSequenceErrors.join("\n")}`,
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [backlogPath, `${nextActionHeading} ordered sequence`],
      itemCount: items.length,
      nextActionCount: nextActionItems.length,
      groups: [...itemsByGroup.entries()].map(([groupKey, groupItems]) => ({
        groupKey,
        count: groupItems.length,
      })),
    },
    null,
    2,
  ),
);
