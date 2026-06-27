// Build a navigable graph from the rebuildable Markdown index.
// Each note is a node. Each wikilink is an edge. Unresolved wikilinks
// produce "missing" nodes. Notes with no incoming or outgoing links
// are flagged as orphans. Connected components are laid out as
// separated islands using a small force-directed simulation per
// component, then shelf-packed into the canvas plane.

import type { VaultIndex } from "./indexer";

export type GNode = {
  id: string;
  label: string;
  path: string;
  type: "note" | "missing" | "orphan";
  outgoingCount: number;
  backlinkCount: number;
  validationIssueCount: number;
  componentId: number;
  x: number;
  y: number;
};

export type GEdge = {
  source: string;
  target: string;
  label?: string;
  type: "wikilink" | "broken";
};

export type ComponentBounds = {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  isOrphans: boolean;
};

export type GraphData = {
  nodes: GNode[];
  edges: GEdge[];
  nodeById: Record<string, GNode>;
  componentBounds: ComponentBounds[];
};

type IssueLike = { path: string };

export function buildGraph(index: VaultIndex, issues: IssueLike[]): GraphData {
  const issueByPath: Record<string, number> = {};
  for (const i of issues) issueByPath[i.path] = (issueByPath[i.path] ?? 0) + 1;

  const nodes: Record<string, GNode> = {};
  const edges: GEdge[] = [];

  for (const note of Object.values(index.notes)) {
    nodes[note.path] = {
      id: note.path,
      label: note.title || note.slug,
      path: note.path,
      type: "note",
      outgoingCount: 0,
      backlinkCount: (index.backlinks[note.path] ?? []).length,
      validationIssueCount: issueByPath[note.path] ?? 0,
      componentId: -1,
      x: 0,
      y: 0,
    };
  }

  for (const note of Object.values(index.notes)) {
    for (const wl of note.wikilinks) {
      const targetPath = index.bySlug[wl.target] ?? index.byId[wl.target];
      if (targetPath) {
        edges.push({
          source: note.path,
          target: targetPath,
          label: wl.anchor,
          type: "wikilink",
        });
        nodes[note.path].outgoingCount++;
      } else {
        const missId = `missing:${wl.target}`;
        if (!nodes[missId]) {
          nodes[missId] = {
            id: missId,
            label: wl.target,
            path: missId,
            type: "missing",
            outgoingCount: 0,
            backlinkCount: 0,
            validationIssueCount: 0,
            componentId: -1,
            x: 0,
            y: 0,
          };
        }
        nodes[missId].backlinkCount++;
        edges.push({
          source: note.path,
          target: missId,
          label: wl.anchor,
          type: "broken",
        });
        nodes[note.path].outgoingCount++;
      }
    }
  }

  // Union-find over edges to detect connected components.
  const ids = Object.keys(nodes);
  const parent: Record<string, string> = {};
  for (const id of ids) parent[id] = id;
  const find = (a: string): string =>
    parent[a] === a ? a : (parent[a] = find(parent[a]));
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const e of edges) union(e.source, e.target);

  const groups: Record<string, string[]> = {};
  for (const id of ids) (groups[find(id)] ||= []).push(id);

  // Singleton real notes become orphans, collected into one cluster.
  const orphanIds: string[] = [];
  const realGroups: string[][] = [];
  for (const g of Object.values(groups)) {
    if (g.length === 1 && nodes[g[0]].type === "note") {
      nodes[g[0]].type = "orphan";
      orphanIds.push(g[0]);
    } else {
      realGroups.push(g);
    }
  }
  realGroups.sort((a, b) => b.length - a.length);

  // Pseudo-random but stable per build.
  let seed = 1;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const layoutComponent = (group: string[], compId: number) => {
    const n = group.length;
    const R = Math.max(40, 22 * Math.sqrt(n));
    group.forEach((id, i) => {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      nodes[id].x = Math.cos(a) * R + (rnd() - 0.5) * 10;
      nodes[id].y = Math.sin(a) * R + (rnd() - 0.5) * 10;
      nodes[id].componentId = compId;
    });
    if (n <= 1) return;
    const root = find(group[0]);
    const localEdges = edges.filter((e) => find(e.source) === root);
    const k = 70;
    const iter = Math.min(250, 80 + n * 4);
    for (let t = 0; t < iter; t++) {
      const temp = (1 - t / iter) * 30;
      const dx: Record<string, number> = {};
      const dy: Record<string, number> = {};
      for (const id of group) {
        dx[id] = 0;
        dy[id] = 0;
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = nodes[group[i]];
          const b = nodes[group[j]];
          let ddx = a.x - b.x;
          let ddy = a.y - b.y;
          let d2 = ddx * ddx + ddy * ddy;
          if (d2 < 0.01) {
            ddx = rnd();
            ddy = rnd();
            d2 = ddx * ddx + ddy * ddy;
          }
          const f = (k * k) / d2;
          dx[a.id] += ddx * f;
          dy[a.id] += ddy * f;
          dx[b.id] -= ddx * f;
          dy[b.id] -= ddy * f;
        }
      }
      for (const e of localEdges) {
        const a = nodes[e.source];
        const b = nodes[e.target];
        const ddx = a.x - b.x;
        const ddy = a.y - b.y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
        const f = (d * d) / k;
        const fx = (ddx / d) * f;
        const fy = (ddy / d) * f;
        dx[a.id] -= fx;
        dy[a.id] -= fy;
        dx[b.id] += fx;
        dy[b.id] += fy;
      }
      for (const id of group) {
        const len = Math.sqrt(dx[id] * dx[id] + dy[id] * dy[id]) || 0.01;
        const m = Math.min(len, temp);
        nodes[id].x += (dx[id] / len) * m;
        nodes[id].y += (dy[id] / len) * m;
      }
    }
  };

  let cid = 0;
  for (const g of realGroups) layoutComponent(g, cid++);

  let orphansCid = -1;
  if (orphanIds.length) {
    orphansCid = cid++;
    const cols = Math.max(1, Math.ceil(Math.sqrt(orphanIds.length)));
    const spacing = 70;
    orphanIds.forEach((id, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      nodes[id].x = c * spacing;
      nodes[id].y = r * spacing;
      nodes[id].componentId = orphansCid;
    });
  }

  const computeBounds = (group: string[]) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of group) {
      const n = nodes[id];
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  };

  const padding = 70;
  const placed: { id: number; ids: string[]; w: number; h: number; isOrphans: boolean }[] = [];
  realGroups.forEach((g, i) => {
    const b = computeBounds(g);
    for (const id of g) {
      nodes[id].x -= b.minX;
      nodes[id].y -= b.minY;
    }
    placed.push({
      id: i,
      ids: g,
      w: b.w + padding,
      h: b.h + padding,
      isOrphans: false,
    });
  });
  if (orphanIds.length) {
    const b = computeBounds(orphanIds);
    for (const id of orphanIds) {
      nodes[id].x -= b.minX;
      nodes[id].y -= b.minY;
    }
    placed.push({
      id: orphansCid,
      ids: orphanIds,
      w: b.w + padding,
      h: b.h + padding,
      isOrphans: true,
    });
  }

  // Shelf-pack the component boxes so islands never overlap.
  const totalArea = placed.reduce((s, c) => s + c.w * c.h, 0);
  const rowMax = Math.max(600, Math.sqrt(totalArea) * 1.6);
  let rowX = 0;
  let rowY = 0;
  let rowH = 0;
  const componentBounds: ComponentBounds[] = [];
  for (const c of placed) {
    if (rowX > 0 && rowX + c.w > rowMax) {
      rowX = 0;
      rowY += rowH + padding;
      rowH = 0;
    }
    for (const id of c.ids) {
      nodes[id].x += rowX;
      nodes[id].y += rowY;
    }
    componentBounds.push({
      id: c.id,
      x: rowX,
      y: rowY,
      w: c.w,
      h: c.h,
      isOrphans: c.isOrphans,
    });
    rowX += c.w + padding;
    if (c.h > rowH) rowH = c.h;
  }

  return {
    nodes: Object.values(nodes),
    edges,
    nodeById: nodes,
    componentBounds,
  };
}