import { useEffect, useMemo, useRef, useState } from "react";
import {
  Crosshair,
  Maximize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GNode, GraphData } from "@/lib/vault/graph";

type Filter = "all" | "neighborhood" | "orphans" | "broken";
type Depth = 1 | 2 | "all";

export function VaultGraph({
  data,
  activePath,
  onSelect,
}: {
  data: GraphData;
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [filter, setFilter] = useState<Filter>("all");
  const [depth, setDepth] = useState<Depth>(1);
  const [hover, setHover] = useState<GNode | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const { visibleNodes, visibleEdges, visibleIds } = useMemo(() => {
    let ids = new Set<string>(data.nodes.map((n) => n.id));
    if (filter === "orphans") {
      ids = new Set(
        data.nodes.filter((n) => n.type === "orphan").map((n) => n.id),
      );
    } else if (filter === "broken") {
      ids = new Set<string>();
      for (const e of data.edges) {
        if (e.type === "broken") {
          ids.add(e.source);
          ids.add(e.target);
        }
      }
    } else if (
      filter === "neighborhood" &&
      activePath &&
      data.nodeById[activePath]
    ) {
      const adj: Record<string, Set<string>> = {};
      for (const e of data.edges) {
        (adj[e.source] ||= new Set()).add(e.target);
        (adj[e.target] ||= new Set()).add(e.source);
      }
      ids = new Set([activePath]);
      const maxDepth = depth === "all" ? Infinity : depth;
      let frontier: Set<string> = new Set([activePath]);
      let d = 0;
      while (frontier.size && d < maxDepth) {
        const next = new Set<string>();
        for (const id of frontier) {
          for (const nb of adj[id] ?? []) {
            if (!ids.has(nb)) {
              ids.add(nb);
              next.add(nb);
            }
          }
        }
        frontier = next;
        d++;
      }
    }
    const nodes = data.nodes.filter((n) => ids.has(n.id));
    const edges = data.edges.filter(
      (e) => ids.has(e.source) && ids.has(e.target),
    );
    return { visibleNodes: nodes, visibleEdges: edges, visibleIds: ids };
  }, [data, filter, depth, activePath]);

  const fit = (nodes: GNode[]) => {
    if (!nodes.length || !size.w || !size.h) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    const pad = 60;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const k = Math.min(size.w / w, size.h / h, 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setTransform({ x: size.w / 2 - cx * k, y: size.h / 2 - cy * k, k });
  };

  // Initial fit when canvas first has a size; refit when filter/depth change.
  const lastFitKey = useRef<string>("");
  useEffect(() => {
    if (!size.w || !size.h) return;
    const key = `${filter}:${depth}:${visibleNodes.length}`;
    if (lastFitKey.current === key) return;
    lastFitKey.current = key;
    fit(visibleNodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, filter, depth, visibleNodes]);

  const fitSelected = () => {
    if (!activePath) return fit(visibleNodes);
    const node = data.nodeById[activePath];
    if (!node) return fit(visibleNodes);
    const compNodes = data.nodes.filter(
      (n) => n.componentId === node.componentId,
    );
    fit(compNodes);
  };

  // Pan + zoom (pointer events for mouse/touch/pinch).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<
    { x: number; y: number; tx: number; ty: number } | null
  >(null);
  const pinchRef = useRef<
    {
      dist: number;
      cx: number;
      cy: number;
      tx: number;
      ty: number;
      k: number;
    } | null
  >(null);
  const movedRef = useRef(false);

  const localXY = (cx: number, cy: number) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedRef.current = false;
    if (pointers.current.size === 1) {
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        tx: transform.x,
        ty: transform.y,
      };
      setDragging(true);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = localXY((a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchRef.current = {
        dist,
        cx: mid.x,
        cy: mid.y,
        tx: transform.x,
        ty: transform.y,
        k: transform.k,
      };
      dragRef.current = null;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const p = pinchRef.current;
      const k = Math.max(0.1, Math.min(5, p.k * (dist / p.dist)));
      const r = k / p.k;
      const newMid = localXY((a.x + b.x) / 2, (a.y + b.y) / 2);
      setTransform({
        x: newMid.x - (p.cx - p.tx) * r,
        y: newMid.y - (p.cy - p.ty) * r,
        k,
      });
      movedRef.current = true;
    } else if (pointers.current.size === 1 && dragRef.current) {
      const d = dragRef.current;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
      setTransform((t) => ({ ...t, x: d.tx + dx, y: d.ty + dy }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) {
      dragRef.current = null;
      setDragging(false);
    }
  };

  // Non-passive wheel listener so we can preventDefault zooming.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setTransform((t) => {
        const k = Math.max(0.1, Math.min(5, t.k * factor));
        const ratio = k / t.k;
        return { x: mx - (mx - t.x) * ratio, y: my - (my - t.y) * ratio, k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (f: number) => {
    setTransform((t) => {
      const k = Math.max(0.1, Math.min(5, t.k * f));
      const ratio = k / t.k;
      const cx = size.w / 2;
      const cy = size.h / 2;
      return { x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio, k };
    });
  };

  const showLabels = transform.k > 0.55;
  const showFullLabels = transform.k > 0.9;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 border-b p-2 flex flex-wrap gap-1.5 items-center">
        <div className="inline-flex rounded border bg-muted/40 overflow-hidden">
          {(["all", "neighborhood", "orphans", "broken"] as Filter[]).map(
            (f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2 py-1 text-[10px] capitalize",
                  filter === f
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {f}
              </button>
            ),
          )}
        </div>
        {filter === "neighborhood" && (
          <div className="inline-flex rounded border bg-muted/40 overflow-hidden">
            {([1, 2, "all"] as Depth[]).map((d) => (
              <button
                key={String(d)}
                onClick={() => setDepth(d)}
                className={cn(
                  "px-2 py-1 text-[10px]",
                  depth === d
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {d === "all" ? "all" : `${d} hop${d > 1 ? "s" : ""}`}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <span className="text-[10px] font-mono text-muted-foreground mr-1">
            {Math.round(transform.k * 100)}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            title="Zoom out"
            onClick={() => zoomBy(1 / 1.2)}
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            title="Zoom in"
            onClick={() => zoomBy(1.2)}
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            title="Fit all"
            onClick={() => fit(visibleNodes)}
          >
            <Maximize2 className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            title="Fit current component"
            onClick={fitSelected}
          >
            <Crosshair className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            title="Reset zoom"
            onClick={() => setTransform({ x: 0, y: 0, k: 1 })}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-hidden bg-muted/20 touch-none select-none"
        style={{
          cursor: dragging ? "grabbing" : "grab",
          overscrollBehavior: "contain",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {visibleNodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            No nodes match this filter.
          </div>
        ) : (
          <svg width={size.w} height={size.h} className="absolute inset-0">
            <g
              transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
            >
              {data.componentBounds
                .filter((c) =>
                  visibleNodes.some((n) => n.componentId === c.id),
                )
                .map((c) => (
                  <rect
                    key={c.id}
                    x={c.x}
                    y={c.y}
                    width={c.w}
                    height={c.h}
                    rx={12}
                    className={cn(
                      "fill-none",
                      c.isOrphans
                        ? "stroke-muted-foreground/25"
                        : "stroke-muted-foreground/15",
                    )}
                    strokeDasharray={`${4 / transform.k} ${3 / transform.k}`}
                    strokeWidth={1 / transform.k}
                  />
                ))}
              {visibleEdges.map((e, i) => {
                const a = data.nodeById[e.source];
                const b = data.nodeById[e.target];
                if (!a || !b) return null;
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={
                      e.type === "broken"
                        ? "stroke-destructive/70"
                        : "stroke-muted-foreground/45"
                    }
                    strokeWidth={1.2 / transform.k}
                    strokeDasharray={
                      e.type === "broken"
                        ? `${4 / transform.k} ${3 / transform.k}`
                        : undefined
                    }
                  />
                );
              })}
              {visibleNodes.map((n) => {
                const isActive = n.id === activePath;
                const r = isActive ? 8 : 6;
                const cls =
                  n.type === "missing"
                    ? "fill-destructive/25 stroke-destructive"
                    : n.type === "orphan"
                      ? "fill-muted stroke-muted-foreground/60"
                      : isActive
                        ? "fill-primary stroke-primary"
                        : "fill-background stroke-foreground/70";
                const label = showFullLabels
                  ? n.label
                  : n.label.length > 14
                    ? n.label.slice(0, 13) + "…"
                    : n.label;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    className="cursor-pointer"
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (movedRef.current) return;
                      if (n.type === "missing") return;
                      onSelect(n.id);
                    }}
                    onPointerEnter={(ev) => {
                      setHover(n);
                      setHoverPos(localXY(ev.clientX, ev.clientY));
                    }}
                    onPointerLeave={() => setHover(null)}
                  >
                    <circle
                      r={r}
                      className={cls}
                      strokeWidth={1.5 / transform.k}
                    />
                    {showLabels && (
                      <text
                        y={r + 10 / transform.k}
                        textAnchor="middle"
                        className="fill-foreground pointer-events-none"
                        style={{
                          fontSize: 11 / transform.k,
                          fontFamily:
                            "ui-sans-serif, system-ui, sans-serif",
                        }}
                      >
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        {hover && (
          <div
            className="absolute pointer-events-none z-10 bg-popover text-popover-foreground border rounded shadow-md px-2 py-1.5 text-[11px] max-w-[240px]"
            style={{
              left: Math.min(hoverPos.x + 12, size.w - 240),
              top: Math.min(hoverPos.y + 12, size.h - 70),
            }}
          >
            <div className="font-medium truncate">{hover.label}</div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              {hover.type === "missing" ? "(missing target)" : hover.path}
            </div>
            <div className="text-muted-foreground mt-0.5">
              → {hover.outgoingCount} · ← {hover.backlinkCount}
              {hover.validationIssueCount > 0 && (
                <span className="text-destructive">
                  {" "}
                  · {hover.validationIssueCount} issue
                  {hover.validationIssueCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
        )}
        <div className="absolute bottom-1 left-2 text-[10px] font-mono text-muted-foreground pointer-events-none">
          {visibleNodes.length} nodes · {visibleEdges.length} edges ·{" "}
          {data.componentBounds.length} components
          {visibleIds.size !== data.nodes.length && " (filtered)"}
        </div>
      </div>
    </div>
  );
}