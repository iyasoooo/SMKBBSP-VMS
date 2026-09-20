import type { MapEdgeKind, MapNodeKind } from '@prisma/client';
import type { Locale } from '@/lib/constants';

/**
 * Campus routing.
 *
 * Deliberately a pure module: it takes a graph and two node codes and returns a
 * path. It does not touch Prisma, React or the request. That is what makes the
 * building's shape testable without a database, and it is the same separation
 * the rest of the domain layer keeps.
 *
 * The algorithm is Dijkstra rather than A*. The graph is roughly a thousand
 * nodes across four levels, so the heuristic would buy nothing measurable, and
 * a straight-line heuristic is not admissible across a staircase anyway - the
 * two ends of a stair edge sit at identical x/y, so any distance-based estimate
 * would understate the climb and could return a path that is not the shortest.
 */

export interface RouteNode {
  code: string;
  levelCode: string;
  levelOrdinal: number;
  kind: MapNodeKind;
  nameEn: string | null;
  nameMs: string | null;
  x: number;
  y: number;
}

export interface RouteEdge {
  toCode: string;
  kind: MapEdgeKind;
  weight: number;
}

export interface RouteGraph {
  nodes: Map<string, RouteNode>;
  adjacency: Map<string, RouteEdge[]>;
}

/** Build the adjacency list. Edges are stored once and walked both ways. */
export function buildRouteGraph(
  nodes: RouteNode[],
  edges: { fromCode: string; toCode: string; kind: MapEdgeKind; weight: number }[],
): RouteGraph {
  const nodeMap = new Map(nodes.map((node) => [node.code, node]));
  const adjacency = new Map<string, RouteEdge[]>();

  for (const node of nodes) adjacency.set(node.code, []);

  for (const edge of edges) {
    if (!nodeMap.has(edge.fromCode) || !nodeMap.has(edge.toCode)) continue;
    adjacency.get(edge.fromCode)!.push({ toCode: edge.toCode, kind: edge.kind, weight: edge.weight });
    adjacency.get(edge.toCode)!.push({ toCode: edge.fromCode, kind: edge.kind, weight: edge.weight });
  }

  return { nodes: nodeMap, adjacency };
}

/** Minimal binary heap; a sorted array would make Dijkstra quadratic. */
class MinHeap {
  private readonly items: { code: string; cost: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(code: string, cost: number): void {
    this.items.push({ code, cost });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent]!.cost <= this.items[i]!.cost) break;
      [this.items[parent], this.items[i]] = [this.items[i]!, this.items[parent]!];
      i = parent;
    }
  }

  pop(): { code: string; cost: number } | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.items[left]!.cost < this.items[smallest]!.cost) smallest = left;
        if (right < this.items.length && this.items[right]!.cost < this.items[smallest]!.cost) smallest = right;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i]!, this.items[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

export interface RouteResult {
  /** Node codes from origin to destination inclusive. */
  path: string[];
  /** Total cost in metres, stairs included. */
  metres: number;
}

/**
 * Shortest walk between two nodes, or null when the destination cannot be
 * reached. Unreachable is a real answer here, not an error: the canteen simply
 * is not reachable from Level 3 without going down, and a level whose stair has
 * been marked out of service would genuinely strand a room.
 */
export function findRoute(graph: RouteGraph, fromCode: string, toCode: string): RouteResult | null {
  if (!graph.nodes.has(fromCode) || !graph.nodes.has(toCode)) return null;
  if (fromCode === toCode) return { path: [fromCode], metres: 0 };

  const best = new Map<string, number>([[fromCode, 0]]);
  const previous = new Map<string, string>();
  const settled = new Set<string>();
  const queue = new MinHeap();
  queue.push(fromCode, 0);

  while (queue.size > 0) {
    const current = queue.pop()!;
    if (settled.has(current.code)) continue;
    settled.add(current.code);
    if (current.code === toCode) break;

    for (const edge of graph.adjacency.get(current.code) ?? []) {
      if (settled.has(edge.toCode)) continue;
      const candidate = current.cost + edge.weight;
      if (candidate < (best.get(edge.toCode) ?? Infinity)) {
        best.set(edge.toCode, candidate);
        previous.set(edge.toCode, current.code);
        queue.push(edge.toCode, candidate);
      }
    }
  }

  const total = best.get(toCode);
  if (total === undefined) return null;

  const path = [toCode];
  while (path[0] !== fromCode) {
    const step = previous.get(path[0]!);
    if (!step) return null;
    path.unshift(step);
  }

  return { path, metres: total };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export type RouteStepKind = 'start' | 'straight' | 'left' | 'right' | 'stairs' | 'arrive';

export interface RouteStep {
  kind: RouteStepKind;
  /** Rounded metres for a walking step; null for stair and arrival steps. */
  metres: number | null;
  /** Place name for start, stairs and arrival steps. */
  place: string | null;
  /** Level the step happens on, so the list can be filtered with the map. */
  levelCode: string;
  /** Level being moved to. Stair steps only. */
  toLevelCode: string | null;
}

/** One level's worth of the drawn line. */
export interface RouteLevelSegment {
  levelCode: string;
  points: { x: number; y: number }[];
}

export interface DescribedRoute extends RouteResult {
  steps: RouteStep[];
  segments: RouteLevelSegment[];
  /** Rounded to the nearest five metres; the plan is not a survey. */
  displayMetres: number;
  walkingMinutes: number;
}

/**
 * Below this a "leg" is not worth announcing: stepping out of a doorway, or the
 * jink where a walkway meets a corridor at a slight offset. Rolling it into the
 * next leg is the difference between eleven instructions and six, and a visitor
 * reading a kiosk will follow six.
 */
const NEGLIGIBLE_LEG_METRES = 9;

/** Under this angle the corridor is straight enough not to call it a turn. */
const TURN_THRESHOLD_DEGREES = 25;

const roundMetres = (metres: number): number => Math.max(5, Math.round(metres / 5) * 5);

const nameOf = (node: RouteNode, locale: Locale): string | null =>
  locale === 'ms' ? node.nameMs ?? node.nameEn : node.nameEn ?? node.nameMs;

/**
 * Turn direction from two consecutive vectors.
 *
 * SVG's y axis points down, so a positive cross product is a clockwise turn on
 * screen, which is the visitor's right when the plan is read the usual way up.
 */
function turnOf(
  previous: { x: number; y: number },
  vertex: { x: number; y: number },
  next: { x: number; y: number },
): 'left' | 'right' | 'straight' {
  const v1 = { x: vertex.x - previous.x, y: vertex.y - previous.y };
  const v2 = { x: next.x - vertex.x, y: next.y - vertex.y };
  const cross = v1.x * v2.y - v1.y * v2.x;
  const dot = v1.x * v2.x + v1.y * v2.y;
  const degrees = Math.abs((Math.atan2(cross, dot) * 180) / Math.PI);
  if (degrees < TURN_THRESHOLD_DEGREES) return 'straight';
  return cross > 0 ? 'right' : 'left';
}

/**
 * Turn a path into something a visitor can follow without looking at a screen,
 * and into per-level polylines for the ones who are.
 *
 * The written list is not a nicety. A drawn line alone is unusable with a
 * screen reader and unreadable on a bright outdoor kiosk, so the words are the
 * primary output and the drawing supports them.
 */
export function describeRoute(
  graph: RouteGraph,
  route: RouteResult,
  locale: Locale,
  metresPerUnit: number,
): DescribedRoute {
  const nodes = route.path.map((code) => graph.nodes.get(code)!);
  const steps: RouteStep[] = [];
  const segments: RouteLevelSegment[] = [];

  const first = nodes[0]!;
  steps.push({
    kind: 'start',
    metres: null,
    place: nameOf(first, locale),
    levelCode: first.levelCode,
    toLevelCode: null,
  });

  let segment: RouteLevelSegment = { levelCode: first.levelCode, points: [{ x: first.x, y: first.y }] };
  let pending = 0;
  // The vertex the current straight leg started from, used for turn geometry.
  let legStart = first;

  for (let i = 1; i < nodes.length; i += 1) {
    const previous = nodes[i - 1]!;
    const node = nodes[i]!;

    if (node.levelCode !== previous.levelCode) {
      // A staircase. Close the leg, the segment, and name the tower.
      if (pending > 0) {
        steps.push({
          kind: 'straight',
          metres: roundMetres(pending),
          place: null,
          levelCode: previous.levelCode,
          toLevelCode: null,
        });
        pending = 0;
      }
      steps.push({
        kind: 'stairs',
        metres: null,
        place: nameOf(previous, locale),
        levelCode: previous.levelCode,
        toLevelCode: node.levelCode,
      });

      segments.push(segment);
      segment = { levelCode: node.levelCode, points: [{ x: node.x, y: node.y }] };
      legStart = node;
      continue;
    }

    pending += Math.hypot(node.x - previous.x, node.y - previous.y) * metresPerUnit;
    segment.points.push({ x: node.x, y: node.y });

    const next = nodes[i + 1];
    if (!next || next.levelCode !== node.levelCode) continue;

    const turn = turnOf(legStart, node, next);
    if (turn === 'straight') continue;
    // Stepping out of a doorway is not a leg worth announcing; roll it forward
    // so the visitor is told "walk 60m and turn left", not "walk 2m, turn left,
    // walk 60m".
    if (pending < NEGLIGIBLE_LEG_METRES) {
      legStart = node;
      continue;
    }

    steps.push({
      kind: turn,
      metres: roundMetres(pending),
      place: null,
      levelCode: node.levelCode,
      toLevelCode: null,
    });
    pending = 0;
    legStart = node;
  }

  segments.push(segment);

  const last = nodes[nodes.length - 1]!;
  steps.push({
    kind: 'arrive',
    metres: pending > 0 ? roundMetres(pending) : null,
    place: nameOf(last, locale),
    levelCode: last.levelCode,
    toLevelCode: null,
  });

  return {
    ...route,
    steps,
    segments,
    displayMetres: roundMetres(route.metres),
    // 75 metres a minute is an unhurried indoor pace, and rounding up means the
    // estimate never tells a visitor they have more time than they do.
    walkingMinutes: Math.max(1, Math.ceil(route.metres / 75)),
  };
}
