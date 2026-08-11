"use client";

import { useEffect, useMemo, useState } from "react";
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

const VIEW_W = 960;
const VIEW_H = 470;
const PAD = { top: 20, bottom: 20, left: 124, right: 196 };
const NODE_W = 13;
// Wide enough that two lines of label fit between neighbouring nodes without
// colliding, which matters more here than packing the bars tightly.
const NODE_GAP = 30;
const MIN_NODE_H = 2;

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
  for (const [depth, list] of byDepth) {
    let y = PAD.top;
    for (const node of list) {
      const height = Math.max(MIN_NODE_H, node.value * scale);
      placed.set(node.id, {
        ...node,
        x: columnX(depth),
        y,
        height,
      });
      y += height + NODE_GAP;
    }
  }

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

export default function FunnelChart({ funnel }: { funnel: Funnel }) {
  const dark = useIsDark();
  const layout = useMemo(() => layoutFunnel(funnel), [funnel]);

  const palette = dark ? DARK : LIGHT;
  const strong = dark ? "#f5f5f5" : "#171717";
  const muted = dark ? "#a3a3a3" : "#737373";

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Application funnel for ${funnel.total} applications`}
    >
      <g>
        {layout.links.map((link) => (
          <path
            key={`${link.source}->${link.target}`}
            d={ribbon(link)}
            // Coloured by where the flow lands, not where it came from.
            // Everything leaves one source here, so colouring by source paints
            // four fifths of the chart the same grey and the destinations —
            // the only thing worth reading off it — become indistinguishable.
            fill={palette[link.target]}
            fillOpacity={dark ? 0.38 : 0.45}
          >
            <title>{`${link.value} ${link.source} → ${link.target}`}</title>
          </path>
        ))}
      </g>

      <g>
        {layout.nodes.map((node) => {
          const atSource = node.depth === 0;
          const labelX = atSource ? node.x - 12 : node.x + NODE_W + 12;
          const anchor = atSource ? "end" : "start";
          const centre = node.y + node.height / 2;
          return (
            <g key={node.id}>
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
  );
}
