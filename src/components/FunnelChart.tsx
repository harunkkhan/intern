"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FUNNEL_LABELS } from "@/lib/analytics";
import type { Funnel, FunnelLink, FunnelNodeId } from "@/lib/analytics";

// Colours are literal attributes rather than Tailwind classes on purpose. The
// chart is serialised to a standalone file by the export button, and a class
// only resolves against the page's stylesheet — an exported SVG full of
// `fill-rose-500` comes out black. The trade is that the theme has to be read
// in JS, which is what the observer below does.
type Palette = Record<FunnelNodeId, string>;

const LIGHT: Palette = {
  applications: "#a8a29e",
  assessment: "#f59e0b",
  interview: "#8b5cf6",
  offer: "#10b981",
  rejected: "#f43f5e",
  withdrawn: "#a1a1aa",
  noResponse: "#94a3b8",
  awaiting: "#3b82f6",
};

const DARK: Palette = {
  applications: "#78716c",
  assessment: "#fbbf24",
  interview: "#a78bfa",
  offer: "#34d399",
  rejected: "#fb7185",
  withdrawn: "#a1a1aa",
  noResponse: "#94a3b8",
  awaiting: "#60a5fa",
};

const VIEW_W = 1000;
const VIEW_H = 600;
const PAD = { top: 26, bottom: 26, left: 128, right: 200 };
const NODE_W = 14;
// Deliberately generous. The source column is one solid bar spanning the full
// height, so it sets the scale and every other column is drawn at whatever is
// left — the gaps are the only thing separating the bands that land together on
// the right, and tight ones ran them into a single mass.
const NODE_GAP = 48;
const MIN_NODE_H = 3;

/** How far everything unrelated fades when a node or band is picked out. */
const DIM = 0.12;

// Fixed order within a column: the stages that continue rightward first, then
// the ways an application can come to rest. Keeping it deterministic means the
// chart doesn't reshuffle itself as counts move.
const ORDER: FunnelNodeId[] = [
  "applications",
  "assessment",
  "interview",
  "offer",
  "awaiting",
  "noResponse",
  "rejected",
  "withdrawn",
];

interface PlacedNode {
  id: FunnelNodeId;
  label: string;
  value: number;
  depth: number;
  x: number;
  y: number;
  height: number;
}

interface PlacedLink {
  source: FunnelNodeId;
  target: FunnelNodeId;
  value: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  thickness: number;
}

export interface Layout {
  nodes: PlacedNode[];
  links: PlacedLink[];
  maxDepth: number;
}

function orderIndex(id: FunnelNodeId): number {
  const i = ORDER.indexOf(id);
  return i === -1 ? ORDER.length : i;
}

/**
 * Lays the funnel out left to right. Exported so the geometry can be checked
 * without a browser.
 */
export function layoutFunnel(funnel: Funnel): Layout {
  const maxDepth = funnel.nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = VIEW_H - PAD.top - PAD.bottom;

  const byDepth = new Map<number, typeof funnel.nodes>();
  for (const node of funnel.nodes) {
    const list = byDepth.get(node.depth) ?? [];
    list.push(node);
    byDepth.set(node.depth, list);
  }
  for (const list of byDepth.values()) {
    list.sort((a, b) => orderIndex(a.id) - orderIndex(b.id));
  }

  // One scale for the whole chart, or a unit of flow would mean a different
  // thickness in each column. The busiest column is the binding constraint.
  let scale = Infinity;
  for (const list of byDepth.values()) {
    const total = list.reduce((sum, n) => sum + n.value, 0);
    if (total <= 0) continue;
    const available = plotH - NODE_GAP * (list.length - 1);
    scale = Math.min(scale, available / total);
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const columnX = (depth: number) =>
    maxDepth === 0
      ? PAD.left
      : PAD.left + (depth * (plotW - NODE_W)) / maxDepth;

  const placed = new Map<FunnelNodeId, PlacedNode>();
  const columns = new Map<number, PlacedNode[]>();
  for (const [depth, list] of byDepth) {
    let y = PAD.top;
    const column: PlacedNode[] = [];
    for (const node of list) {
      const height = Math.max(MIN_NODE_H, node.value * scale);
      const p = { ...node, x: columnX(depth), y, height };
      placed.set(node.id, p);
      column.push(p);
      y += height + NODE_GAP;
    }
    columns.set(depth, column);
  }

  relax(columns, funnel.links, placed);

  // Ribbons stack per node, ordered by where the other end sits vertically:
  // bands leaving a node are sorted by their target's centre, bands arriving
  // are sorted by their source's centre. Ordering the whole link list at once
  // instead leaves every band that shares a source in an arbitrary order, and
  // they cross each other on the way out.
  const centre = (id: FunnelNodeId) => {
    const node = placed.get(id);
    return node ? node.y + node.height / 2 : 0;
  };

  const usable = funnel.links.filter(
    (l) => placed.has(l.source) && placed.has(l.target),
  );
  const thickness = new Map<FunnelLink, number>(
    usable.map((l) => [l, Math.max(MIN_NODE_H, l.value * scale)]),
  );

  const y0 = new Map<FunnelLink, number>();
  const y1 = new Map<FunnelLink, number>();

  for (const node of placed.values()) {
    let offset = node.y;
    for (const link of usable
      .filter((l) => l.source === node.id)
      .sort((a, b) => centre(a.target) - centre(b.target))) {
      y0.set(link, offset);
      offset += thickness.get(link)!;
    }

    offset = node.y;
    for (const link of usable
      .filter((l) => l.target === node.id)
      .sort((a, b) => centre(a.source) - centre(b.source))) {
      y1.set(link, offset);
      offset += thickness.get(link)!;
    }
  }

  const links: PlacedLink[] = usable.map((link) => ({
    source: link.source,
    target: link.target,
    value: link.value,
    x0: placed.get(link.source)!.x + NODE_W,
    y0: y0.get(link)!,
    x1: placed.get(link.target)!.x,
    y1: y1.get(link)!,
    thickness: thickness.get(link)!,
  }));

  return { nodes: [...placed.values()], links, maxDepth };
}

/**
 * Nudges each node toward the weighted centre of what it connects to.
 *
 * Stacking columns from the top and leaving them there is what made the chart
 * look broken: "No response" is fed from the bottom of the source bar but was
 * drawn at the top of its column, so its band swept diagonally across
 * everything and left the corner beneath it empty. A few passes of the
 * relaxation a real Sankey does pulls nodes level with their flow.
 */
function relax(
  columns: Map<number, PlacedNode[]>,
  links: FunnelLink[],
  placed: Map<FunnelNodeId, PlacedNode>,
): void {
  const depths = [...columns.keys()].sort((a, b) => a - b);
  const centre = (id: FunnelNodeId) => {
    const n = placed.get(id);
    return n ? n.y + n.height / 2 : 0;
  };

  // Weighted mean of the far ends of a node's links, by flow. A thick band
  // pulls harder than a thin one, which is what keeps the bulk of the chart
  // level rather than letting a stray single application drag a node around.
  const pull = (id: FunnelNodeId, side: "in" | "out"): number | null => {
    const relevant = links.filter((l) =>
      side === "in" ? l.target === id : l.source === id,
    );
    let weight = 0;
    let sum = 0;
    for (const link of relevant) {
      const other = side === "in" ? link.source : link.target;
      if (!placed.has(other)) continue;
      sum += centre(other) * link.value;
      weight += link.value;
    }
    return weight > 0 ? sum / weight : null;
  };

  const settle = (column: PlacedNode[], top: number, bottom: number) => {
    column.sort((a, b) => a.y - b.y);
    // Push apart downward, then pull back up off the bottom edge, which is the
    // standard two-sweep fix — one sweep alone can shove the last node out.
    let y = top;
    for (const node of column) {
      if (node.y < y) node.y = y;
      y = node.y + node.height + NODE_GAP;
    }
    y = bottom;
    for (let i = column.length - 1; i >= 0; i--) {
      const node = column[i]!;
      if (node.y + node.height > y) node.y = y - node.height;
      y = node.y - NODE_GAP;
    }
  };

  const top = PAD.top;
  const bottom = VIEW_H - PAD.bottom;

  for (let pass = 0; pass < 8; pass++) {
    const alpha = 0.9 ** pass;
    for (const depth of depths) {
      for (const node of columns.get(depth)!) {
        const target = pull(node.id, "in");
        if (target !== null) {
          node.y += (target - (node.y + node.height / 2)) * alpha;
        }
      }
      settle(columns.get(depth)!, top, bottom);
    }
    for (const depth of [...depths].reverse()) {
      for (const node of columns.get(depth)!) {
        const target = pull(node.id, "out");
        if (target !== null) {
          node.y += (target - (node.y + node.height / 2)) * alpha;
        }
      }
      settle(columns.get(depth)!, top, bottom);
    }
  }
}

/** A Sankey band: two cubic curves with straight caps at each node. */
function ribbon(link: PlacedLink): string {
  const mid = (link.x0 + link.x1) / 2;
  const { x0, x1, y0, y1, thickness: t } = link;
  return [
    `M${x0},${y0}`,
    `C${mid},${y0} ${mid},${y1} ${x1},${y1}`,
    `L${x1},${y1 + t}`,
    `C${mid},${y1 + t} ${mid},${y0 + t} ${x0},${y0 + t}`,
    "Z",
  ].join(" ");
}

function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.classList.contains("dark"));
    update();
    // The theme toggle mutates this class directly, so watch it rather than
    // leaving the chart in the colours it happened to mount with.
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** What the pointer is over: a node, a band, or nothing. */
type Focus =
  | { kind: "node"; id: FunnelNodeId }
  | { kind: "link"; source: FunnelNodeId; target: FunnelNodeId };

function sameFocus(a: Focus | null, b: Focus | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "node" && b.kind === "node") return a.id === b.id;
  if (a.kind === "link" && b.kind === "link")
    return a.source === b.source && a.target === b.target;
  return false;
}

export default function FunnelChart({ funnel }: { funnel: Funnel }) {
  const dark = useIsDark();
  const layout = useMemo(() => layoutFunnel(funnel), [funnel]);

  const [hovered, setHovered] = useState<Focus | null>(null);
  const [pinned, setPinned] = useState<Focus | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Every enter records the position as well as the target. Leaving it to
  // pointermove alone means the tooltip has nowhere to sit for whichever event
  // arrives first, and it silently doesn't render.
  function trackPointer(e: { clientX: number; clientY: number }) {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    setPointer({ x: e.clientX - box.left, y: e.clientY - box.top });
  }

  function enter(next: Focus, e: { clientX: number; clientY: number }) {
    setHovered(next);
    trackPointer(e);
  }

  // Hovering previews over whatever is pinned, so you can look around without
  // losing the section you clicked.
  const focus = hovered ?? pinned;

  const palette = dark ? DARK : LIGHT;
  const strong = dark ? "#f5f5f5" : "#171717";
  const muted = dark ? "#a3a3a3" : "#737373";

  /** Whether a node stays lit: it is the focus, or it is on the focused band. */
  function nodeLit(id: FunnelNodeId): boolean {
    if (!focus) return true;
    if (focus.kind === "node") {
      if (focus.id === id) return true;
      // The far end of anything touching the focused node stays lit too, or the
      // highlighted bands would run into unreadable stubs.
      return layout.links.some(
        (l) =>
          (l.source === focus.id && l.target === id) ||
          (l.target === focus.id && l.source === id),
      );
    }
    return focus.source === id || focus.target === id;
  }

  function linkLit(link: PlacedLink): boolean {
    if (!focus) return true;
    if (focus.kind === "node")
      return link.source === focus.id || link.target === focus.id;
    return link.source === focus.source && link.target === focus.target;
  }

  function pick(next: Focus) {
    // Clicking the same thing again releases it, so the chart can always be got
    // back to its full state without hunting for empty space.
    setPinned((current) => (sameFocus(current, next) ? null : next));
  }

  const tip = focus
    ? focus.kind === "node"
      ? (() => {
          const node = layout.nodes.find((n) => n.id === focus.id);
          return node ? `${node.value} · ${node.label}` : null;
        })()
      : (() => {
          const link = layout.links.find(
            (l) => l.source === focus.source && l.target === focus.target,
          );
          if (!link) return null;
          const from = FUNNEL_LABELS[link.source];
          const to = FUNNEL_LABELS[link.target];
          return `${link.value} · ${from} → ${to}`;
        })()
    : null;

  return (
    <div
      ref={wrap}
      className="relative"
      onPointerLeave={() => {
        setHovered(null);
        setPointer(null);
      }}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Application funnel for ${funnel.total} applications`}
        onPointerMove={trackPointer}
      >
        {/* Catches clicks that land on nothing, so the pinned section can be
            released by clicking the background. */}
        <rect
          x="0"
          y="0"
          width={VIEW_W}
          height={VIEW_H}
          fill="transparent"
          onClick={() => setPinned(null)}
        />

        <g>
          {layout.links.map((link) => {
            const lit = linkLit(link);
            return (
              <path
                key={`${link.source}->${link.target}`}
                d={ribbon(link)}
                // Coloured by where the flow lands, not where it came from.
                // Everything leaves one source here, so colouring by source
                // paints four fifths of the chart the same grey and the
                // destinations become indistinguishable.
                fill={palette[link.target]}
                fillOpacity={lit ? (dark ? 0.42 : 0.5) : DIM}
                className="cursor-pointer transition-[fill-opacity] duration-150"
                onPointerEnter={(e) =>
                  enter(
                    { kind: "link", source: link.source, target: link.target },
                    e,
                  )
                }
                onClick={(e) => {
                  e.stopPropagation();
                  pick({
                    kind: "link",
                    source: link.source,
                    target: link.target,
                  });
                }}
              />
            );
          })}
        </g>

        <g>
          {layout.nodes.map((node) => {
            const atSource = node.depth === 0;
            const labelX = atSource ? node.x - 12 : node.x + NODE_W + 12;
            const anchor = atSource ? "end" : "start";
            const centre = node.y + node.height / 2;
            const lit = nodeLit(node.id);
            return (
              <g
                key={node.id}
                className="cursor-pointer transition-opacity duration-150"
                opacity={lit ? 1 : DIM}
                onPointerEnter={(e) => enter({ kind: "node", id: node.id }, e)}
                onClick={(e) => {
                  e.stopPropagation();
                  pick({ kind: "node", id: node.id });
                }}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={NODE_W}
                  height={node.height}
                  fill={palette[node.id]}
                />
                <text
                  x={labelX}
                  y={centre - 1}
                  textAnchor={anchor}
                  fill={strong}
                  fontSize="19"
                  fontWeight="600"
                >
                  {node.value}
                </text>
                <text
                  x={labelX}
                  y={centre + 15}
                  textAnchor={anchor}
                  fill={muted}
                  fontSize="12.5"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Plain HTML rather than SVG text: it follows the pointer in screen
          pixels regardless of how the viewBox is scaled, and it stays out of
          the markup the export serialises. */}
      {tip && pointer && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-800 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          style={{ left: pointer.x, top: pointer.y - 8 }}
        >
          {tip}
        </div>
      )}

      {pinned && (
        <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
          Highlighting one section — click it again, or the background, to show
          all.
        </p>
      )}
    </div>
  );
}
