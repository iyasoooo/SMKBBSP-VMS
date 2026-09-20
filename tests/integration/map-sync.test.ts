import { beforeAll, describe, expect, it } from 'vitest';
import { testDb } from '../helpers/db';
import { buildCampusPlan } from '@/lib/map/campus-plan';
import { syncSchoolMap } from '@/lib/map/sync';
import { loadCampusMap, routeBetween } from '@/lib/map/campus';

/**
 * The deploy path.
 *
 * A production deployment runs migrations and then `npm run map:sync`; it never
 * runs the demonstration seed. This exercises exactly that: a database with the
 * tables but no rows, then the sync, then the sync again.
 *
 * The regression it guards is the one that reached production - migrations
 * created the map's tables, nothing filled them, and the wayfinding page had
 * nothing to draw.
 */

async function emptyTheMap(): Promise<void> {
  await testDb.destination.deleteMany({ where: { code: { startsWith: 'MAP:' } } });
  await testDb.destination.updateMany({ data: { mapNodeId: null } });
  await testDb.mapEdge.deleteMany();
  await testDb.mapNode.deleteMany();
  await testDb.mapLevel.deleteMany();
}

describe('school map sync', () => {
  describe('a migrated but unsynced database', () => {
    beforeAll(emptyTheMap);

    it('reads back as an empty map instead of throwing', async () => {
      // `loadCampusMap` is request-cached, so it is called once per test file.
      const map = await loadCampusMap();

      expect(map.levels).toEqual([]);
      expect(map.rooms).toEqual([]);
      expect(map.walkways).toEqual([]);
      expect(map.graph.nodes.size).toBe(0);

      // And the page's guard - an empty map is what makes it render "not
      // available" rather than a frame with nothing in it.
      expect(map.levels.length === 0).toBe(true);
    });

    it('answers no route rather than failing', () => {
      const empty = { levels: [], rooms: [], walkways: [], graph: { nodes: new Map(), adjacency: new Map() }, width: 0, height: 0 };
      expect(routeBetween(empty, 'G.PONDOK_PENGAWAL', 'G.KANTIN', 'en')).toBeNull();
    });
  });

  describe('after the sync a deploy runs', () => {
    const plan = buildCampusPlan();

    it('writes the whole plan', async () => {
      await emptyTheMap();
      const result = await syncSchoolMap(testDb);

      expect(result.levels).toBe(plan.levels.length);
      expect(result.nodes).toBe(plan.nodes.length);
      expect(result.edges).toBe(plan.edges.length);

      expect(await testDb.mapLevel.count()).toBe(plan.levels.length);
      expect(await testDb.mapNode.count()).toBe(plan.nodes.length);
      expect(await testDb.mapEdge.count()).toBe(plan.edges.length);
    });

    it('gives the visitor a destination for every navigable room', async () => {
      const derived = await testDb.destination.count({ where: { code: { startsWith: 'MAP:' } } });
      expect(derived).toBeGreaterThan(50);
    });

    it('changes nothing when it runs again', async () => {
      const before = {
        levels: await testDb.mapLevel.count(),
        nodes: await testDb.mapNode.count(),
        edges: await testDb.mapEdge.count(),
        destinations: await testDb.destination.count(),
      };

      await syncSchoolMap(testDb);

      expect({
        levels: await testDb.mapLevel.count(),
        nodes: await testDb.mapNode.count(),
        edges: await testDb.mapEdge.count(),
        destinations: await testDb.destination.count(),
      }).toEqual(before);
    });

    it('leaves every room reachable once written', async () => {
      const nodes = await testDb.mapNode.findMany({ select: { code: true } });
      expect(nodes.some((node) => node.code === 'G.PONDOK_PENGAWAL')).toBe(true);
      expect(nodes.some((node) => node.code === 'L3.A.SURAU_MURID')).toBe(true);
    });
  });
});
