export type LineDiffRow =
  | { kind: "equal"; left: string; right: string }
  | { kind: "removed"; left: string; right?: undefined }
  | { kind: "added"; left?: undefined; right: string }
  | { kind: "changed"; left: string; right: string };

export type NumberedLineDiffRow =
  | { kind: "equal"; left: string; right: string; leftLine: number; rightLine: number }
  | { kind: "removed"; left: string; right?: undefined; leftLine: number; rightLine?: undefined }
  | { kind: "added"; left?: undefined; right: string; leftLine?: undefined; rightLine: number }
  | { kind: "changed"; left: string; right: string; leftLine: number; rightLine: number };

export type ContextLineDiffRow = NumberedLineDiffRow | { kind: "gap" };

type RawOp =
  | { kind: "equal"; line: string }
  | { kind: "removed"; line: string }
  | { kind: "added"; line: string };

export function buildLineDiff(leftText: string, rightText: string): LineDiffRow[] {
  const left = splitLines(leftText);
  const right = splitLines(rightText);
  const lcs = buildLcsTable(left, right);
  const raw = backtrackDiff(left, right, lcs);
  return coalesceChanges(raw);
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function buildLcsTable(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i][j] =
        left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function backtrackDiff(left: string[], right: string[], table: number[][]): RawOp[] {
  const ops: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      ops.push({ kind: "equal", line: left[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: "removed", line: left[i] });
      i++;
    } else {
      ops.push({ kind: "added", line: right[j] });
      j++;
    }
  }
  while (i < left.length) ops.push({ kind: "removed", line: left[i++] });
  while (j < right.length) ops.push({ kind: "added", line: right[j++] });
  return ops;
}

function coalesceChanges(raw: RawOp[]): LineDiffRow[] {
  const rows: LineDiffRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const current = raw[i];
    if (current.kind === "equal") {
      rows.push({ kind: "equal", left: current.line, right: current.line });
      continue;
    }

    const removed: string[] = [];
    const added: string[] = [];
    while (i < raw.length && raw[i].kind !== "equal") {
      const op = raw[i];
      if (op.kind === "removed") removed.push(op.line);
      else added.push(op.line);
      i++;
    }
    i--;

    const pairCount = Math.min(removed.length, added.length);
    for (let index = 0; index < pairCount; index++) {
      rows.push({ kind: "changed", left: removed[index], right: added[index] });
    }
    for (const line of removed.slice(pairCount)) rows.push({ kind: "removed", left: line });
    for (const line of added.slice(pairCount)) rows.push({ kind: "added", right: line });
  }
  return rows;
}

export function numberLineDiffRows(rows: LineDiffRow[]): NumberedLineDiffRow[] {
  let leftLine = 1;
  let rightLine = 1;
  return rows.map((row) => {
    if (row.kind === "equal") {
      return { ...row, leftLine: leftLine++, rightLine: rightLine++ };
    }
    if (row.kind === "changed") {
      return { ...row, leftLine: leftLine++, rightLine: rightLine++ };
    }
    if (row.kind === "removed") {
      return { ...row, leftLine: leftLine++ };
    }
    return { ...row, rightLine: rightLine++ };
  });
}

export function buildContextLineDiff(
  rows: NumberedLineDiffRow[],
  contextLines = 2,
): ContextLineDiffRow[] {
  const changedIndexes = rows
    .map((row, index) => (row.kind === "equal" ? -1 : index))
    .filter((index) => index >= 0);

  if (changedIndexes.length === 0) return [];

  const ranges: { start: number; end: number }[] = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(rows.length - 1, index + contextLines);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const out: ContextLineDiffRow[] = [];
  for (const range of ranges) {
    if (out.length > 0) out.push({ kind: "gap" });
    out.push(...rows.slice(range.start, range.end + 1));
  }
  return out;
}
