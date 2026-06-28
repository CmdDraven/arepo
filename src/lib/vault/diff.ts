export type LineDiffRow =
  | { kind: "equal"; left: string; right: string }
  | { kind: "removed"; left: string; right?: undefined }
  | { kind: "added"; left?: undefined; right: string }
  | { kind: "changed"; left: string; right: string };

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
