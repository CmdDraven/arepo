import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Info, Maximize2, RotateCcw, ZoomIn, ZoomOut, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GNode, GraphData } from "@/lib/vault/graph";

type Filter = "all" | "neighborhood" | "orphans" | "broken";
type Depth = 1 | 2 | "all";

export function VaultGraph({
  data,
  activePath,
  onSelect,
  onOpenPreview,
  selectedPaths = new Set(),
  onSelectionChange,
}: {
  data: GraphData;
  activePath: string | null;
  onSelect: (path: string) => void;
  onOpenPreview?: (path: string) => void;
  selectedPaths?: Set<string>;
  onSelectionChange?: (paths: string[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [filter, setFilter] = useState<Filter>("all");
  const [depth, setDepth] = useState<Depth>(1);
  const [hover, setHover] = useState<GNode | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [pinned, setPinned] = useState<GNode | null>(null);
  const [pinnedPos, setPinnedPos] = useState({ x: 0, y: 0 });
  const [showLegend, setShowLegend] = useState(false);
  const [showClusters, setShowClusters] = useState(false);
  const [selectionDrag, setSelectionDrag] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

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
      ids = new Set(data.nodes.filter((n) => n.type === "orphan").map((n) => n.id));
    } else if (filter === "broken") {
      ids = new Set<string>();
      for (const e of data.edges) {
        if (e.type === "broken") {
          ids.add(e.source);
          ids.add(e.target);
        }
      }
    } else if (filter === "neighborhood" && activePath && data.nodeById[activePath]) {
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
    const edges = data.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
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
    const compNodes = data.nodes.filter((n) => n.componentId === node.componentId);
    fit(compNodes);
  };

  // Pan + zoom (pointer events for mouse/touch/pinch).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchRef = useRef<{
    dist: number;
    cx: number;
    cy: number;
    tx: number;
    ty: number;
    k: number;
  } | null>(null);
  const movedRef = useRef(false);
  const nodeSelectionRef = useRef<{
    node: GNode;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const boxSelectionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  const localXY = (cx: number, cy: number) => {
    const r = containerRef.current!.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  const screenXY = (node: GNode) => ({
    x: node.x * transform.k + transform.x,
    y: node.y * transform.k + transform.y,
  });

  const pathsInSelectionRect = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    return visibleNodes
      .filter((node) => node.type !== "missing")
      .filter((node) => {
        const p = screenXY(node);
        return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
      })
      .map((node) => node.id);
  };

  const pathAtPoint = (point: { x: number; y: number }) => {
    let nearest: { path: string; distance: number } | null = null;
    for (const node of visibleNodes) {
      if (node.type === "missing") continue;
      const p = screenXY(node);
      const distance = Math.hypot(p.x - point.x, p.y - point.y);
      if (distance <= 14 && (!nearest || distance < nearest.distance)) {
        nearest = { path: node.id, distance };
      }
    }
    return nearest?.path ?? null;
  };

  const commitSelection = (paths: string[], additive: boolean) => {
    if (!onSelectionChange) return;
    if (additive) {
      onSelectionChange(Array.from(new Set([...selectedSet, ...paths])));
    } else {
      onSelectionChange(paths);
    }
  };

  const toggleSelectedPath = (path: string) => {
    if (!onSelectionChange) return;
    const next = new Set(selectedSet);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onSelectionChange(Array.from(next));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    movedRef.current = false;
    if (e.shiftKey && onSelectionChange) {
      const pos = localXY(e.clientX, e.clientY);
      boxSelectionRef.current = {
        pointerId: e.pointerId,
        startX: pos.x,
        startY: pos.y,
        moved: false,
      };
      setSelectionDrag({
        startX: pos.x,
        startY: pos.y,
        currentX: pos.x,
        currentY: pos.y,
      });
      setDragging(false);
      setPinned(null);
      e.preventDefault();
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    const box = boxSelectionRef.current;
    if (box?.pointerId === e.pointerId) {
      const pos = localXY(e.clientX, e.clientY);
      if (Math.abs(pos.x - box.startX) + Math.abs(pos.y - box.startY) > 3) {
        box.moved = true;
      }
      setSelectionDrag({
        startX: box.startX,
        startY: box.startY,
        currentX: pos.x,
        currentY: pos.y,
      });
      e.preventDefault();
      return;
    }
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
    const box = boxSelectionRef.current;
    if (box?.pointerId === e.pointerId) {
      const pos = localXY(e.clientX, e.clientY);
      if (box.moved) {
        commitSelection(
          pathsInSelectionRect({ x: box.startX, y: box.startY }, { x: pos.x, y: pos.y }),
          false,
        );
      } else {
        const path = pathAtPoint(pos);
        if (path) toggleSelectedPath(path);
        else commitSelection([], false);
      }
      boxSelectionRef.current = null;
      setSelectionDrag(null);
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
      e.preventDefault();
      return;
    }
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
  const clustersVisible = showClusters || transform.k < 0.5;

  const emptyMessage =
    filter === "orphans"
      ? "No orphan notes."
      : filter === "broken"
        ? "No broken links."
        : filter === "neighborhood" && (!activePath || !data.nodeById[activePath])
          ? "Select a note to view its neighborhood."
          : "No nodes match this filter.";

  const details = pinned ?? hover;
  const detailsPos = pinned ? pinnedPos : hoverPos;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 border-b p-2 flex flex-wrap gap-1.5 items-center">
        <div className="inline-flex rounded border bg-muted/40 overflow-hidden">
          {(["all", "neighborhood", "orphans", "broken"] as Filter[]).map((f) => (
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
          ))}
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
            variant={showLegend ? "secondary" : "ghost"}
            className="h-6 w-6 p-0"
            title="Legend"
            onClick={() => setShowLegend((s) => !s)}
          >
            <Info className="size-3.5" />
          </Button>
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
          cursor: selectionDrag ? "crosshair" : dragging ? "grabbing" : "grab",
          overscrollBehavior: "contain",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          setPinned(null);
          onSelectionChange?.([]);
        }}
      >
        {visibleNodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <svg width={size.w} height={size.h} className="absolute inset-0">
            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
              {clustersVisible &&
                data.componentBounds
                  .filter((c) => visibleNodes.some((n) => n.componentId === c.id))
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
                        c.isOrphans ? "stroke-muted-foreground/15" : "stroke-muted-foreground/10",
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
                      e.type === "broken" ? "stroke-destructive/70" : "stroke-muted-foreground/45"
                    }
                    strokeWidth={1.2 / transform.k}
                    strokeDasharray={
                      e.type === "broken" ? `${4 / transform.k} ${3 / transform.k}` : undefined
                    }
                  />
                );
              })}
              {visibleNodes.map((n) => {
                const isActive = n.id === activePath;
                const isSelected = selectedSet.has(n.id);
                const r = isActive || isSelected ? 8 : 6;
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
                    onPointerDown={(ev) => {
                      if (ev.shiftKey) return;
                      ev.stopPropagation();
                      if (n.type === "missing") return;
                      const pos = localXY(ev.clientX, ev.clientY);
                      nodeSelectionRef.current = {
                        node: n,
                        startX: pos.x,
                        startY: pos.y,
                        moved: false,
                      };
                      (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
                    }}
                    onPointerMove={(ev) => {
                      const drag = nodeSelectionRef.current;
                      if (!drag || drag.node.id !== n.id) return;
                      const pos = localXY(ev.clientX, ev.clientY);
                      if (Math.abs(pos.x - drag.startX) + Math.abs(pos.y - drag.startY) > 4) {
                        drag.moved = true;
                      }
                    }}
                    onPointerUp={(ev) => {
                      const drag = nodeSelectionRef.current;
                      if (!drag || drag.node.id !== n.id) return;
                      ev.stopPropagation();
                      nodeSelectionRef.current = null;
                      if (drag.moved || n.type === "missing") return;
                      commitSelection([n.id], false);
                      const pinnedAt = localXY(ev.clientX, ev.clientY);
                      setPinned(n);
                      setPinnedPos(pinnedAt);
                      setHover(null);
                    }}
                    onClick={(ev) => ev.stopPropagation()}
                    onPointerEnter={(ev) => {
                      if (pinned) return;
                      setHover(n);
                      setHoverPos(localXY(ev.clientX, ev.clientY));
                    }}
                    onPointerLeave={() => {
                      if (!pinned) setHover(null);
                    }}
                  >
                    {isSelected && (
                      <circle
                        r={r + 5 / transform.k}
                        className="fill-none stroke-primary/70"
                        strokeWidth={1.8 / transform.k}
                      />
                    )}
                    <circle r={r} className={cls} strokeWidth={1.5 / transform.k} />
                    {showLabels && (
                      <text
                        y={r + 10 / transform.k}
                        textAnchor="middle"
                        className="fill-foreground pointer-events-none"
                        style={{
                          fontSize: 11 / transform.k,
                          fontFamily: "ui-sans-serif, system-ui, sans-serif",
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
        {visibleNodes.length > 0 && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[260px] rounded border bg-popover/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
            Hold Shift and drag to select an area. Shift-click nodes to add or remove.
          </div>
        )}
        {selectionDrag && (
          <div
            className="absolute z-20 pointer-events-none border border-primary/70 bg-primary/10"
            style={{
              left: Math.min(selectionDrag.startX, selectionDrag.currentX),
              top: Math.min(selectionDrag.startY, selectionDrag.currentY),
              width: Math.abs(selectionDrag.currentX - selectionDrag.startX),
              height: Math.abs(selectionDrag.currentY - selectionDrag.startY),
            }}
          />
        )}
        {selectedSet.size > 0 && (
          <div className="absolute left-2 bottom-2 z-10 rounded border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-sm">
            {selectedSet.size} selected
          </div>
        )}
        {details && !pinned && (
          <div
            className="absolute pointer-events-none z-10 bg-popover text-popover-foreground border rounded shadow-md px-2 py-1.5 text-[11px] max-w-[240px]"
            style={{
              left: Math.min(detailsPos.x + 12, size.w - 240),
              top: Math.min(detailsPos.y + 12, size.h - 70),
            }}
          >
            <div className="font-medium truncate">{details.label}</div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              {details.type === "missing" ? "(missing target)" : details.path}
            </div>
            <div className="text-muted-foreground mt-0.5">
              → {details.outgoingCount} · ← {details.backlinkCount}
              {details.validationIssueCount > 0 && (
                <span className="text-destructive">
                  {" "}
                  · {details.validationIssueCount} issue
                  {details.validationIssueCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
        )}
        {pinned && (
          <div
            className="absolute z-20 bg-popover text-popover-foreground border rounded shadow-md text-[11px] w-[240px]"
            style={{
              left: Math.min(Math.max(8, pinnedPos.x + 12), size.w - 248),
              top: Math.min(Math.max(8, pinnedPos.y + 12), size.h - 140),
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-1 px-2 pt-1.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{pinned.label}</div>
                <div className="font-mono text-[10px] text-muted-foreground truncate">
                  {pinned.type === "missing" ? "(missing target)" : pinned.path}
                </div>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => setPinned(null)}
                title="Close"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="px-2 pb-1.5 text-muted-foreground">
              → {pinned.outgoingCount} · ← {pinned.backlinkCount}
              {pinned.validationIssueCount > 0 && (
                <span className="text-destructive">
                  {" "}
                  · {pinned.validationIssueCount} issue
                  {pinned.validationIssueCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {pinned.type !== "missing" && (
              <div className="flex border-t">
                <button
                  className="flex-1 px-2 py-1.5 text-[11px] hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onSelect(pinned.id);
                    setPinned(null);
                  }}
                >
                  Open in Edit
                </button>
                {onOpenPreview && (
                  <button
                    className="flex-1 px-2 py-1.5 text-[11px] border-l hover:bg-accent hover:text-accent-foreground"
                    onClick={() => {
                      onOpenPreview(pinned.id);
                      setPinned(null);
                    }}
                  >
                    Open in Preview
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {showLegend && (
          <div className="absolute top-2 right-2 z-10 bg-popover text-popover-foreground border rounded shadow-md text-[11px] w-[200px]">
            <div className="flex items-center justify-between px-2 py-1 border-b">
              <span className="font-medium">Legend</span>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setShowLegend(false)}
                title="Close"
              >
                <X className="size-3" />
              </button>
            </div>
            <ul className="px-2 py-1.5 space-y-1">
              <li className="flex items-center gap-2">
                <svg width={14} height={14}>
                  <circle
                    cx={7}
                    cy={7}
                    r={5}
                    className="fill-background stroke-foreground/70"
                    strokeWidth={1.5}
                  />
                </svg>
                <span>Note</span>
              </li>
              <li className="flex items-center gap-2">
                <svg width={14} height={14}>
                  <circle cx={7} cy={7} r={6} className="fill-primary stroke-primary" />
                </svg>
                <span>Selected note</span>
              </li>
              <li className="flex items-center gap-2">
                <svg width={14} height={14}>
                  <circle
                    cx={7}
                    cy={7}
                    r={5}
                    className="fill-muted stroke-muted-foreground/60"
                    strokeWidth={1.5}
                  />
                </svg>
                <span>Orphan (no links)</span>
              </li>
              <li className="flex items-center gap-2">
                <svg width={14} height={14}>
                  <circle
                    cx={7}
                    cy={7}
                    r={5}
                    className="fill-destructive/25 stroke-destructive"
                    strokeWidth={1.5}
                  />
                </svg>
                <span>Broken link target</span>
              </li>
              <li className="flex items-center gap-2">
                <svg width={20} height={6}>
                  <line
                    x1={0}
                    y1={3}
                    x2={20}
                    y2={3}
                    className="stroke-destructive"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                  />
                </svg>
                <span>Broken edge</span>
              </li>
            </ul>
            <div className="border-t px-2 py-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showClusters}
                  onChange={(e) => setShowClusters(e.target.checked)}
                />
                <span>Show cluster boundaries</span>
              </label>
            </div>
          </div>
        )}
        <div className="absolute bottom-1 left-2 text-[10px] font-mono text-muted-foreground pointer-events-none">
          {visibleNodes.length === 0
            ? ""
            : `${visibleNodes.length} nodes · ${visibleEdges.length} edges${
                visibleIds.size !== data.nodes.length ? " (filtered)" : ""
              }`}
        </div>
      </div>
    </div>
  );
}
