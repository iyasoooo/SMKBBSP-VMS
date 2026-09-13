import { describe, expect, it } from 'vitest';
import { MapEdgeKind, MapNodeCategory, MapNodeKind } from '@prisma/client';
import {
  buildCampusPlan,
  CAMPUS_LEVELS,
  DEFAULT_ORIGIN_CODE,
  DESTINATION_MAP_NODES,
  MAP_METRES_PER_UNIT,
} from '@/lib/map/campus-plan';
import { buildRouteGraph, describeRoute, findRoute, type RouteGraph } from '@/lib/map/route';

/**
 * The wayfinding graph is data a person typed in from a floor plan, so the
 * failure mode is not a broken algorithm but a room nobody connected to a
 * corridor. Connectivity is therefore asserted exhaustively rather than
 * sampled: an unreachable room is a visitor standing in a corridor being told
 * to go nowhere.
 */

const plan = buildCampusPlan();

const graph: RouteGraph = buildRouteGraph(
  plan.nodes.map((node) => ({
    code: node.code,
    levelCode: node.levelCode,
    levelOrdinal: CAMPUS_LEVELS.find((level) => level.code === node.levelCode)!.ordinal,
    kind: node.kind,
    nameEn: node.nameEn,
    nameMs: node.nameMs,
    x: node.x,
    y: node.y,
  })),
  plan.edges,
);

const rooms = plan.nodes.filter((node) => node.kind === MapNodeKind.ROOM || node.kind === MapNodeKind.GATE);

describe('campus plan', () => {
  it('transcribes all four levels of the school plan', () => {
    expect(plan.levels.map((level) => level.code)).toEqual(['G', 'L1', 'L2', 'L3']);
  });

  it('gives every node a unique code', () => {
    const codes = new Set(plan.nodes.map((node) => node.code));
    expect(codes.size).toBe(plan.nodes.length);
  });

  it('never references a node an edge cannot resolve', () => {
    const codes = new Set(plan.nodes.map((node) => node.code));
    for (const edge of plan.edges) {
      expect(codes.has(edge.fromCode), `missing ${edge.fromCode}`).toBe(true);
      expect(codes.has(edge.toCode), `missing ${edge.toCode}`).toBe(true);
    }
  });

  it('keeps room rectangles inside the plan frame', () => {
    for (const node of plan.nodes) {
      if (node.width === null || node.height === null) continue;
      expect(node.x - node.width / 2).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width / 2).toBeLessThanOrEqual(2000);
      expect(node.y - node.height / 2).toBeGreaterThanOrEqual(0);
      expect(node.y + node.height / 2).toBeLessThanOrEqual(1450);
    }
  });

  it('puts the outdoor grounds on the ground level only', () => {
    // The upper plans draw these as roofs, so routing onto them from Level 2
    // would send a visitor over a parapet.
    for (const code of ['PADANG', 'KANTIN', 'DATARAN', 'BENGKEL_RBT', 'PONDOK_PENGAWAL']) {
      const matches = plan.nodes.filter((node) => node.code.endsWith(`.${code}`));
      expect(matches).toHaveLength(1);
      expect(matches[0]!.levelCode).toBe('G');
    }
  });

  it('never runs a walkway through a room', () => {
    // The bug this guards: a stair tower linked to a corridor on the far side of
    // a block, so the drawn route crossed the store rooms in between and told a
    // visitor to walk through a locked door.
    // Open areas and landscaping are excluded: the assembly square and the
    // field are places you walk across, not rooms you would be walking through.
    const rooms = plan.nodes.filter(
      (node) =>
        node.kind === MapNodeKind.ROOM &&
        node.width !== null &&
        node.height !== null &&
        node.category !== MapNodeCategory.OPEN_AREA &&
        node.category !== MapNodeCategory.LANDSCAPE,
    );
    const byLevel = new Map<string, typeof rooms>();
    for (const room of rooms) {
      const list = byLevel.get(room.levelCode) ?? [];
      list.push(room);
      byLevel.set(room.levelCode, list);
    }

    const offenders: string[] = [];
    for (const edge of plan.edges) {
      if (edge.kind !== MapEdgeKind.WALK) continue;
      const from = plan.nodes.find((node) => node.code === edge.fromCode)!;
      const to = plan.nodes.find((node) => node.code === edge.toCode)!;
      // A doorway edge is allowed to touch its own room, and stair towers are
      // drawn boxes that walkways are supposed to run into.
      if (from.kind !== MapNodeKind.JUNCTION || to.kind !== MapNodeKind.JUNCTION) continue;
      if (from.levelCode !== to.levelCode) continue;

      const candidates = byLevel.get(from.levelCode) ?? [];
      const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        const inside = candidates.find(
          (room) =>
            x > room.x - room.width! / 2 + 1 &&
            x < room.x + room.width! / 2 - 1 &&
            y > room.y - room.height! / 2 + 1 &&
            y < room.y + room.height! / 2 - 1,
        );
        if (inside) {
          offenders.push(`${edge.fromCode} -> ${edge.toCode} crosses ${inside.code}`);
          break;
        }
      }
    }

    // Joined so a failure names the edge and the room instead of a bare count.
    expect(offenders.join(' | ')).toBe('');
  });

  it('tells apart the toilets on different floors', () => {
    // Eight rows all called "Toilets" is a search result nobody can act on.
    const toilets = plan.nodes.filter(
      (node) => node.kind === MapNodeKind.ROOM && node.code.includes('.TANDAS'),
    );
    expect(toilets.length).toBeGreaterThan(6);

    const names = toilets.map((node) => node.nameEn);
    expect(new Set(names).size).toBe(names.length);
    for (const node of toilets) {
      expect(node.nameEn, node.code).toMatch(/ (G|L1|L2|L3)$/);
      expect(node.nameMs, node.code).toMatch(/ Aras (B|1|2|3)$/);
    }
  });

  it('gives every floor a hallway from Block B through to Staircase C', () => {
    for (const level of CAMPUS_LEVELS) {
      const hall = plan.nodes.find((node) => node.code === `${level.code}.B.HALL`);
      expect(hall, `${level.code} has no Block B hallway`).toBeDefined();

      const route = findRoute(graph, `${level.code}.B.HALL`, `${level.code}.TANGGA_C`);
      expect(route, `${level.code} hallway does not reach Staircase C`).not.toBeNull();
      // Through the gap and along the northern walkway - nothing like the trek
      // around the eastern flank it replaces.
      expect(route!.metres).toBeLessThan(30);
    }
  });

  it('takes the hallway rather than the long way round the eastern flank', () => {
    // Level 1, from the toilet at the east end of Block B to the prefects room
    // at the east end of Block C. Before the hallway existed the only way was
    // out to the eastern walkway, down, and back in.
    const route = findRoute(graph, 'L1.B.TANDAS_L', 'L1.C.BILIK_PENGAWAS')!;
    expect(route).not.toBeNull();
    expect(route.path).toContain('L1.B.HALL');
    expect(route.path.some((code) => code.startsWith('L1.STRIP_E'))).toBe(false);
  });

  it('puts the main gate behind the guard house, not beside it', () => {
    const guard = plan.nodes.find((node) => node.code === 'G.PONDOK_PENGAWAL')!;
    const gate = plan.nodes.find((node) => node.code === 'G.PINTU_A')!;

    expect(gate.x).toBe(guard.x);
    expect(gate.y).toBeGreaterThan(guard.y);

    // And they are one entrance: the only way in from the gate is past the hut.
    const route = findRoute(graph, 'G.PINTU_A', 'G.DATARAN')!;
    expect(route.path).toContain('G.PONDOK_PENGAWAL');
  });

  it('names the science labs the way the school does', () => {
    const labs = plan.nodes.filter((node) => node.nameMs?.startsWith('Makmal Sains'));
    expect(labs.map((lab) => lab.nameMs).sort()).toEqual([
      'Makmal Sains A',
      'Makmal Sains B',
      'Makmal Sains C',
      'Makmal Sains D',
    ]);
  });

  it('carries the eastern walkway on the ground level only', () => {
    // It exists to reach the canteen, which is on the ground. Upstairs the plan
    // shows its roof, and a walkway onto a roof is not a route.
    for (const level of CAMPUS_LEVELS) {
      const strip = plan.nodes.filter((node) => node.code.startsWith(`${level.code}.STRIP_E`));
      if (level.ordinal === 0) expect(strip.length).toBeGreaterThan(0);
      else expect(strip, `${level.code} should have no eastern walkway`).toEqual([]);
    }
  });

  it('binds every seeded destination to a room that exists', () => {
    const codes = new Set(plan.nodes.map((node) => node.code));
    for (const [destination, nodeCode] of Object.entries(DESTINATION_MAP_NODES)) {
      expect(codes.has(nodeCode), `${destination} -> ${nodeCode}`).toBe(true);
    }
  });
});

describe('routing', () => {
  it('reaches every room and gate from the guard house', () => {
    const unreachable = rooms
      .filter((room) => room.code !== DEFAULT_ORIGIN_CODE)
      .filter((room) => findRoute(graph, DEFAULT_ORIGIN_CODE, room.code) === null)
      .map((room) => room.code);

    expect(unreachable).toEqual([]);
  });

  it('returns null for a node that is not on the map', () => {
    expect(findRoute(graph, DEFAULT_ORIGIN_CODE, 'G.A.NO_SUCH_ROOM')).toBeNull();
  });

  it('costs the same in both directions', () => {
    const there = findRoute(graph, DEFAULT_ORIGIN_CODE, 'L2.A.BILIK_UBK');
    const back = findRoute(graph, 'L2.A.BILIK_UBK', DEFAULT_ORIGIN_CODE);
    expect(there).not.toBeNull();
    expect(back).not.toBeNull();
    expect(there!.metres).toBeCloseTo(back!.metres, 6);
  });

  it('stays on the ground floor between two ground-floor places', () => {
    const route = findRoute(graph, DEFAULT_ORIGIN_CODE, 'G.KANTIN');
    expect(route).not.toBeNull();
    for (const code of route!.path) {
      expect(graph.nodes.get(code)!.levelCode).toBe('G');
    }
  });

  it('climbs one level to reach the principal on Level 1', () => {
    const route = findRoute(graph, DEFAULT_ORIGIN_CODE, 'L1.A.PENGETUA');
    expect(route).not.toBeNull();

    const levels = new Set(route!.path.map((code) => graph.nodes.get(code)!.levelCode));
    expect([...levels].sort()).toEqual(['G', 'L1']);
  });

  it('uses a stair for every level it changes and no more', () => {
    const route = findRoute(graph, 'G.KANTIN', 'L3.A.K_4K5');
    expect(route).not.toBeNull();

    let stairs = 0;
    for (let i = 1; i < route!.path.length; i += 1) {
      const from = graph.nodes.get(route!.path[i - 1]!)!;
      const to = graph.nodes.get(route!.path[i]!)!;
      if (from.levelCode !== to.levelCode) stairs += 1;
    }
    expect(stairs).toBe(3);
  });

  it('changes level only at a staircase', () => {
    const route = findRoute(graph, DEFAULT_ORIGIN_CODE, 'L3.B.K_3A_1A')!;
    for (let i = 1; i < route.path.length; i += 1) {
      const from = graph.nodes.get(route.path[i - 1]!)!;
      const to = graph.nodes.get(route.path[i]!)!;
      if (from.levelCode === to.levelCode) continue;
      expect(from.kind).toBe(MapNodeKind.STAIR);
      expect(to.kind).toBe(MapNodeKind.STAIR);
    }
  });

  it('prefers the nearer of two staircases', () => {
    // The counselling room sits at the west end of Block A on Level 2, so the
    // route in from the guard house should use a west tower, not walk the full
    // length of the block to the east one.
    const route = findRoute(graph, DEFAULT_ORIGIN_CODE, 'L2.A.TANDAS_A')!;
    const towers = route.path.filter((code) => graph.nodes.get(code)!.kind === MapNodeKind.STAIR);
    expect(towers.length).toBeGreaterThan(0);
    for (const tower of towers) {
      expect(graph.nodes.get(tower)!.x).toBeLessThan(1000);
    }
  });

  it('marks stair edges as stairs so they can be costed differently', () => {
    const stairEdges = plan.edges.filter((edge) => edge.kind === MapEdgeKind.STAIR);
    // Four towers, three gaps between four levels.
    expect(stairEdges).toHaveLength(12);
    for (const edge of stairEdges) {
      expect(edge.weight).toBeGreaterThan(0);
    }
  });
});

describe('written directions', () => {
  const route = findRoute(graph, DEFAULT_ORIGIN_CODE, 'L1.A.PEJABAT_AM')!;
  const described = describeRoute(graph, route, 'ms', MAP_METRES_PER_UNIT);

  it('opens at the origin and closes at the destination', () => {
    expect(described.steps[0]!.kind).toBe('start');
    expect(described.steps[0]!.place).toBe('Pondok Pengawal');
    expect(described.steps[described.steps.length - 1]!.kind).toBe('arrive');
    expect(described.steps[described.steps.length - 1]!.place).toBe('Pejabat Am / Bilik PK');
  });

  it('names the staircase it asks the visitor to climb', () => {
    const stairStep = described.steps.find((step) => step.kind === 'stairs');
    expect(stairStep).toBeDefined();
    expect(stairStep!.place).toMatch(/^Tangga [A-D]$/);
    expect(stairStep!.toLevelCode).toBe('L1');
  });

  it('answers in the requested language', () => {
    const english = describeRoute(graph, route, 'en', MAP_METRES_PER_UNIT);
    expect(english.steps[0]!.place).toBe('Guard house');
    expect(english.steps[english.steps.length - 1]!.place).toBe('General Office');
  });

  it('splits the drawn line into one polyline per level', () => {
    expect(described.segments.map((segment) => segment.levelCode)).toEqual(['G', 'L1']);
    for (const segment of described.segments) {
      expect(segment.points.length).toBeGreaterThan(1);
    }
  });

  it('never announces a leg shorter than a doorway', () => {
    // Rolling the doorway hop into the next leg is what stops the list reading
    // "walk 2m, turn left, walk 2m, turn right" on the way out of a room.
    for (const step of described.steps) {
      if (step.metres === null) continue;
      expect(step.metres).toBeGreaterThanOrEqual(5);
    }
  });

  it('rounds distance and time rather than implying a survey', () => {
    expect(described.displayMetres % 5).toBe(0);
    expect(described.walkingMinutes).toBeGreaterThanOrEqual(1);
  });

  it('describes a walk with no level change as a single segment', () => {
    const flat = findRoute(graph, DEFAULT_ORIGIN_CODE, 'G.A.DEWAN')!;
    const describedFlat = describeRoute(graph, flat, 'en', MAP_METRES_PER_UNIT);
    expect(describedFlat.segments).toHaveLength(1);
    expect(describedFlat.steps.some((step) => step.kind === 'stairs')).toBe(false);
  });
});
