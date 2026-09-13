import { MapEdgeKind, MapNodeCategory, MapNodeKind } from '@prisma/client';

/**
 * The SMK Bandar Baru Seri Petaling campus, transcribed from the school's own
 * 2026 floor plans (ground plus three upper levels).
 *
 * This module is authoring data, in the same spirit as `prisma/seed-data.ts`:
 * a human writes the building down here, the seed writes it into Postgres, and
 * everything at runtime reads it back out of the database. Nothing imports it
 * to answer a request.
 *
 * Two decisions keep the transcription honest:
 *
 *   - Room widths are RELATIVE. The plans are drawn to a grid, not to a survey,
 *     and pretending to know that a store room is 3.4 metres wide would be a
 *     fiction. Spans are normalised across each block, so the drawing keeps the
 *     proportions of the original without claiming a precision it does not have.
 *   - Distances are therefore approximate, and every metre figure the interface
 *     shows is rounded to five metres. A visitor needs to know "about eighty
 *     metres, two turns", not a number that looks surveyed.
 */

// ---------------------------------------------------------------------------
// Plan geometry
// ---------------------------------------------------------------------------

/** Plan units. Every level shares this frame, which is what lets a stair keep
 *  the same x/y across levels and the route line stay put when levels change. */
export const PLAN_WIDTH = 2000;
export const PLAN_HEIGHT = 1450;

/**
 * Ten classrooms span the teaching strip, and a classroom is about 7.2m wide,
 * so the strip is roughly 72m for 1608 plan units. Stated as a constant because
 * it is the single assumption that turns the drawing into distances.
 */
export const MAP_METRES_PER_UNIT = 0.045;

/** A flight of stairs, expressed as the walking distance it feels like. */
export const STAIR_WEIGHT_METRES = 18;

/** Horizontal extent of the room strip inside each block. */
const STRIP_X0 = 212;
const STRIP_X1 = 1820;

/**
 * Corridors run past the room strip and meet the perimeter walkways here.
 *
 * Both values sit OUTSIDE [STRIP_X0, STRIP_X1] on purpose. A corridor end that
 * falls within the strip puts the turn at the end of the block inside the last
 * room, and every route leaving the block then draws a line through it.
 */
const CORRIDOR_W = 186;
const CORRIDOR_E = 1832;

/** The two stair towers sit at these x positions on every level. */
const TOWER_W_X = 220;
const TOWER_E_X = 1583;

/**
 * Vertical walkways down the west and east flanks of the teaching blocks -
 * "Laluan ke Padang" and "Laluan ke Kantin" on the plan. These are how a
 * visitor gets from one block to another without passing a room, so they are
 * kept clear of the room strip at both ends.
 */
const WEST_STRIP_X = 135;
const EAST_STRIP_X = 1852;

interface BlockGeometry {
  /** Vertical centre of the room rectangles. */
  roomY: number;
  roomHeight: number;
  /** Vertical centre of the corridor the rooms open onto. */
  corridorY: number;
}

/**
 * Each block's rooms open onto the walkway on ONE face, and which face matters:
 * a corridor drawn on the wrong side sends the route the long way round the
 * building, or worse, straight through somebody's classroom.
 *
 * A and B face inwards, onto the courtyards. C is the northernmost block and
 * also faces in, so all three corridors look onto the Gelanggang or the Laman.
 */
const BLOCKS: Record<'A' | 'B' | 'C', BlockGeometry> = {
  C: { roomY: 175, roomHeight: 100, corridorY: 241 },
  B: { roomY: 442, roomHeight: 95, corridorY: 509 },
  A: { roomY: 708, roomHeight: 97, corridorY: 643 },
};

/**
 * Stair towers, and the block corridors each one opens onto on its own level.
 *
 * A tower stands in the courtyard between two blocks, but it can only serve a
 * corridor that faces it. D and C sit in the Gelanggang: Block C's corridor
 * looks onto it, Block B's back is turned, so they serve C alone - reaching
 * Block B from there would mean walking through the store rooms along its
 * northern wall. B and A sit in the Laman Sri Endah with a corridor on either
 * side, so they serve both.
 *
 * Getting between Block C and Block B is therefore done on the flank walkways,
 * which run clear of every room. That is a longer walk, and it is the real one.
 */
const TOWERS = [
  { code: 'TANGGA_D', nameEn: 'Staircase D', nameMs: 'Tangga D', x: TOWER_W_X, y: 320, links: ['C'] },
  { code: 'TANGGA_C', nameEn: 'Staircase C', nameMs: 'Tangga C', x: TOWER_E_X, y: 320, links: ['C'] },
  { code: 'TANGGA_B', nameEn: 'Staircase B', nameMs: 'Tangga B', x: TOWER_W_X, y: 586, links: ['B', 'A'] },
  { code: 'TANGGA_A', nameEn: 'Staircase A', nameMs: 'Tangga A', x: TOWER_E_X, y: 586, links: ['B', 'A'] },
] as const;

/** The main covered walkway along the south face of Block A. */
const MAIN_WALK_Y = 813;

/**
 * The covered walkway along the north face of Block B, between the block and
 * the Gelanggang. Block B's rooms turn their backs on it, so it is reached
 * through the hallways that pass between them - which is what makes Staircase C
 * and Staircase D usable from Block B at all.
 */
const NORTH_B_WALK_Y = 376;

// ---------------------------------------------------------------------------
// Room transcription
// ---------------------------------------------------------------------------

type BlockId = 'A' | 'B' | 'C';

interface RoomSpec {
  code: string;
  nameEn: string;
  nameMs: string;
  category: MapNodeCategory;
  /** Relative width. Normalised against the other rooms in the same block row. */
  span?: number;
  /**
   * Which face the room's door is on. Everything defaults to the block's own
   * corridor; 'south' puts the door on the main covered walkway instead, for
   * the few ground-floor rooms the plan labels it as serving.
   */
  doorSide?: 'south';
  /**
   * Append the level tag to the name. Set on rooms that exist on every floor
   * under the same name - a search for "toilet" is useless if it returns eight
   * rows all called "Toilet".
   */
  suffixLevel?: boolean;
}

/**
 * A gap in a block's room row: the covered link that runs through the block to
 * the walkway on its far side. Drawn as nothing, which is the point - it is the
 * space between two rooms, and the graph needs it because without it the only
 * way from Block B to Block C is the long way round the flank.
 */
interface HallwaySpec {
  hallway: true;
  span?: number;
}

type RowEntry = RoomSpec | HallwaySpec;

const isHallway = (entry: RowEntry): entry is HallwaySpec => 'hallway' in entry;

interface LevelSpec {
  code: string;
  ordinal: number;
  nameEn: string;
  nameMs: string;
  /** Short tag appended to rooms that repeat on every floor, e.g. toilets. */
  shortEn: string;
  shortMs: string;
  blocks: Record<BlockId, RowEntry[]>;
}

const CLASS = MapNodeCategory.CLASSROOM;
const SPECIAL = MapNodeCategory.SPECIAL_ROOM;
const ADMIN = MapNodeCategory.ADMIN;
const SERVICE = MapNodeCategory.SERVICE;

export const CAMPUS_LEVELS: LevelSpec[] = [
  {
    code: 'G',
    ordinal: 0,
    nameEn: 'Ground floor',
    nameMs: 'Aras Bawah',
    shortEn: 'G',
    shortMs: 'Aras B',
    blocks: {
      C: [
        { code: 'TANDAS_P', nameEn: 'Girls toilet', nameMs: 'Tandas Murid (P)', category: SERVICE, suffixLevel: true },
        { code: 'PAM_AIR', nameEn: 'Water pump room', nameMs: 'Blk Pam Air', category: SERVICE },
        { code: 'STUDIO_PSV', nameEn: 'Art studio', nameMs: 'Studio PSV', category: SPECIAL },
        { code: 'MAKMAL_D', nameEn: 'Science Lab D', nameMs: 'Makmal Sains D', category: SPECIAL, span: 2 },
        { code: 'PERSEDIAAN_C', nameEn: 'Preparation room', nameMs: 'Bilik Persediaan', category: ADMIN },
        { code: 'MAKMAL_KIMIA', nameEn: 'Chemistry Lab', nameMs: 'Makmal Kimia', category: SPECIAL, span: 2 },
        { code: 'STOR_ICT', nameEn: 'ICT store', nameMs: 'Stor ICT', category: SERVICE },
        { code: 'SUIS_C', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE },
      ],
      B: [
        { code: 'BILIK_JUARA', nameEn: 'Bilik Juara', nameMs: 'Bilik Juara', category: ADMIN },
        { code: 'PERSEDIAAN_B1', nameEn: 'Preparation room', nameMs: 'Bilik Persediaan', category: ADMIN },
        { code: 'MAKMAL_A', nameEn: 'Science Lab A', nameMs: 'Makmal Sains A', category: SPECIAL },
        { code: 'MAKMAL_B', nameEn: 'Science Lab B', nameMs: 'Makmal Sains B', category: SPECIAL },
        { code: 'PERSEDIAAN_B2', nameEn: 'Preparation room', nameMs: 'Bilik Persediaan', category: ADMIN },
        { code: 'MAKMAL_C', nameEn: 'Science Lab C', nameMs: 'Makmal Sains C', category: SPECIAL },
        { code: 'RUANG_LEGAR', nameEn: 'Concourse', nameMs: 'Ruang Legar', category: MapNodeCategory.CIRCULATION },
        { code: 'KEDAI_BUKU', nameEn: 'Bookshop', nameMs: 'Kedai Buku', category: MapNodeCategory.STAIR_BLOCK },
        { hallway: true, span: 0.5 },
        { code: 'PAM_B', nameEn: 'Pump room', nameMs: 'Bilik Pam', category: SERVICE },
        { code: 'SUIS_B', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE },
      ],
      A: [
        { code: 'TANDAS_L', nameEn: 'Boys toilet', nameMs: 'Tandas Murid (L)', category: SERVICE, span: 1.3, suffixLevel: true },
        { code: 'PAM_A', nameEn: 'Pump room', nameMs: 'Bilik Pam', category: SERVICE },
        { code: 'PERABOT', nameEn: 'Furniture store', nameMs: 'Bilik Perabot', category: SERVICE, span: 1.2 },
        { code: 'KESIHATAN', nameEn: 'Sick bay', nameMs: 'Bilik Kesihatan', category: ADMIN, span: 1.3 },
        { code: 'DEWAN', nameEn: 'Dewan Seri Endah (hall)', nameMs: 'Dewan Seri Endah', category: MapNodeCategory.STAIR_BLOCK, span: 5.8, doorSide: 'south' },
        { code: 'KOPERASI', nameEn: 'Co-operative shop', nameMs: 'Koperasi', category: MapNodeCategory.STAIR_BLOCK, span: 1.9 },
        { code: 'BILIK_KOP', nameEn: 'Co-operative office', nameMs: 'Bilik Kop.', category: MapNodeCategory.STAIR_BLOCK },
        { code: 'SUIS_A', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE, span: 0.8 },
      ],
    },
  },
  {
    code: 'L1',
    ordinal: 1,
    nameEn: 'Level 1',
    nameMs: 'Aras 1',
    shortEn: 'L1',
    shortMs: 'Aras 1',
    blocks: {
      C: [
        { code: 'STOR_PEMBERSIHAN', nameEn: 'Cleaning store', nameMs: 'Stor Pembersihan', category: SERVICE },
        { code: 'STOR_SPBT', nameEn: 'Textbook store', nameMs: 'Stor SPBT', category: SERVICE },
        { code: 'MAKMAL_FIZIK', nameEn: 'Physics Lab', nameMs: 'Makmal Fizik', category: SPECIAL, span: 2 },
        { code: 'MAKMAL_BIOLOGI', nameEn: 'Biology Lab', nameMs: 'Makmal Biologi', category: SPECIAL, span: 2 },
        { code: 'SBC_MATEMATIK', nameEn: 'Mathematics resource room', nameMs: 'SBC Matematik', category: SPECIAL, span: 2 },
        { code: 'BILIK_PENGAWAS', nameEn: 'Prefects room', nameMs: 'Bilik Pengawas', category: ADMIN },
        { code: 'SUIS_C', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE },
      ],
      B: [
        { code: 'BILIK_CETAK', nameEn: 'Printing room', nameMs: 'Bilik Cetak', category: ADMIN },
        { code: 'PEPERIKSAAN', nameEn: 'Examinations room', nameMs: 'Bilik Peperiksaan', category: ADMIN },
        { code: 'SERI_CENDANA', nameEn: 'Bilik Seri Cendana', nameMs: 'Bilik Seri Cendana', category: ADMIN },
        { code: 'BILIK_APD', nameEn: 'Teaching aids room', nameMs: 'Bilik APD', category: SPECIAL },
        { code: 'PSS', nameEn: 'Library / Resource Centre', nameMs: 'Bejana Ilmu (PSS)', category: SPECIAL, span: 2 },
        { code: 'TANDAS_L', nameEn: 'Boys toilet', nameMs: 'Tandas Murid (L)', category: SERVICE, suffixLevel: true },
        { code: 'STOR_B', nameEn: 'Store', nameMs: 'Stor', category: SERVICE },
        { hallway: true, span: 0.5 },
        { code: 'STOR_PEJABAT', nameEn: 'Office store', nameMs: 'Stor Pejabat', category: SERVICE },
        { code: 'SUIS_B', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE },
      ],
      A: [
        { code: 'TANDAS_GURU_P', nameEn: 'Staff toilet (women)', nameMs: 'Tandas Guru (P)', category: SERVICE, suffixLevel: true },
        { code: 'TANDAS_PELAWAT', nameEn: 'Visitor toilet', nameMs: 'Tandas Pelawat', category: SERVICE, suffixLevel: true },
        { code: 'TANDAS_GURU_L', nameEn: 'Staff toilet (men)', nameMs: 'Tandas Guru (L)', category: SERVICE, suffixLevel: true },
        { code: 'SURAU_GURU', nameEn: 'Staff prayer room', nameMs: 'Surau Guru', category: SPECIAL },
        { code: 'BILIK_GKMP', nameEn: 'Head of department room', nameMs: 'Bilik GKMP', category: ADMIN },
        { code: 'BILIK_GURU', nameEn: 'Teachers staff room', nameMs: 'Bilik Guru (Staf Akademik)', category: ADMIN, span: 2.4 },
        { code: 'PEJABAT_AM', nameEn: 'General Office', nameMs: 'Pejabat Am / Bilik PK', category: ADMIN, span: 1.3 },
        { code: 'BILIK_PK', nameEn: 'Senior assistants office', nameMs: 'Pejabat / Bilik PK', category: ADMIN, span: 1.3 },
        { code: 'PENGETUA', nameEn: "Principal's office", nameMs: 'Bilik Pengetua', category: ADMIN, span: 1.2 },
        { code: 'SUIS_A', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE, span: 0.6 },
      ],
    },
  },
  {
    code: 'L2',
    ordinal: 2,
    nameEn: 'Level 2',
    nameMs: 'Aras 2',
    shortEn: 'L2',
    shortMs: 'Aras 2',
    blocks: {
      C: [
        { code: 'TANDAS_C', nameEn: 'Toilet (Block C)', nameMs: 'Tandas (Blok C)', category: SERVICE, suffixLevel: true },
        { code: 'BILIK_SPBT', nameEn: 'Textbook scheme room', nameMs: 'Bilik SPBT', category: ADMIN },
        { code: 'SBC_BAHASA', nameEn: 'Languages resource room', nameMs: 'SBC Bahasa', category: SPECIAL },
        { code: 'K_4ST1', nameEn: 'Class 4ST1 / 2H', nameMs: 'Kelas 4ST1 / 2H', category: CLASS },
        { code: 'K_4ST2', nameEn: 'Class 4ST2 / 2G', nameMs: 'Kelas 4ST2 / 2G', category: CLASS },
        { code: 'K_4K1', nameEn: 'Class 4K1 / 2E', nameMs: 'Kelas 4K1 / 2E', category: CLASS },
        { code: 'K_4K2', nameEn: 'Class 4K2 / 2D', nameMs: 'Kelas 4K2 / 2D', category: CLASS },
        { code: 'K_5K5', nameEn: 'Class 5K5', nameMs: 'Kelas 5K5', category: CLASS },
        { code: 'BILIK_BCINA', nameEn: 'Chinese language room', nameMs: 'Bilik B.Cina', category: ADMIN },
        { code: 'SUIS_C', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE },
      ],
      B: [
        { code: 'BILIK_LOGISTIK', nameEn: 'Logistics room', nameMs: 'Bilik Logistik', category: ADMIN },
        { code: 'SBC_TEKVOK', nameEn: 'Technical & vocational room', nameMs: 'SBC Tek/Vok', category: SPECIAL },
        { code: 'STUDIO_REKA', nameEn: 'Design studio', nameMs: 'Studio Reka Bentuk', category: SPECIAL },
        { code: 'K_PA_1H', nameEn: 'Class PA / 1H', nameMs: 'Kelas PA / 1H', category: CLASS },
        { code: 'K_3H_1D', nameEn: 'Class 3H / 1D', nameMs: 'Kelas 3H / 1D', category: CLASS },
        { code: 'K_3D_1D', nameEn: 'Class 3D / 1D', nameMs: 'Kelas 3D / 1D', category: CLASS },
        { code: 'TANDAS_P', nameEn: 'Girls toilet', nameMs: 'Tandas Murid (P)', category: SERVICE, suffixLevel: true },
        { code: 'STOR_B', nameEn: 'Store', nameMs: 'Stor', category: SERVICE },
        { hallway: true, span: 0.5 },
        { code: 'STOR_PMORAL', nameEn: 'Moral studies store', nameMs: 'Stor P.Moral', category: SERVICE },
        { code: 'SUIS_B', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE },
      ],
      A: [
        { code: 'TANDAS_A', nameEn: 'Toilet (Block A)', nameMs: 'Tandas (Blok A)', category: SERVICE, suffixLevel: true },
        { code: 'BILIK_GURU_ERT', nameEn: 'Home science staff room', nameMs: 'Bilik Guru ERT', category: ADMIN },
        { code: 'SBC_ERT', nameEn: 'Home science / cookery room', nameMs: 'SBC ERT / Masakan', category: SPECIAL, span: 2 },
        { code: 'SBC_SEJARAH', nameEn: 'History resource room', nameMs: 'SBC Sejarah', category: SPECIAL },
        { code: 'BILIK_MESYUARAT', nameEn: 'Meeting room (Seri Tempawan)', nameMs: 'Bilik Mesyuarat Seri Tempawan', category: ADMIN, span: 2 },
        { code: 'BILIK_UBK', nameEn: 'Counselling Room', nameMs: 'Bilik UBK (Kaunseling)', category: ADMIN },
        { code: 'BILIK_DISIPLIN', nameEn: 'Discipline room', nameMs: 'Bilik Disiplin', category: ADMIN },
        { code: 'SUIS_A', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE },
      ],
    },
  },
  {
    code: 'L3',
    ordinal: 3,
    nameEn: 'Level 3',
    nameMs: 'Aras 3',
    shortEn: 'L3',
    shortMs: 'Aras 3',
    blocks: {
      C: [
        { code: 'TANDAS_C', nameEn: 'Toilet (Block C)', nameMs: 'Tandas (Blok C)', category: SERVICE, suffixLevel: true },
        { code: 'BILIK_AEROBIK', nameEn: 'Aerobics / culture room', nameMs: 'Bilik Aerobik / Kebudayaan', category: ADMIN },
        { code: 'K_5ST1', nameEn: 'Class 5ST1', nameMs: 'Kelas 5ST1', category: CLASS },
        { code: 'K_5ST2', nameEn: 'Class 5ST2', nameMs: 'Kelas 5ST2', category: CLASS },
        { code: 'K_5K1', nameEn: 'Class 5K1', nameMs: 'Kelas 5K1', category: CLASS },
        { code: 'K_5K2', nameEn: 'Class 5K2', nameMs: 'Kelas 5K2', category: CLASS },
        { code: 'K_5K3', nameEn: 'Class 5K3', nameMs: 'Kelas 5K3', category: CLASS },
        { code: 'K_5K4', nameEn: 'Class 5K4', nameMs: 'Kelas 5K4', category: CLASS },
        { code: 'STOR_PERABOT', nameEn: 'Furniture store', nameMs: 'Stor Perabot', category: SERVICE },
        { code: 'SUIS_C', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE },
      ],
      B: [
        { code: 'SBC_GEOGRAFI', nameEn: 'Geography resource room', nameMs: 'SBC Geografi', category: SPECIAL },
        { code: 'K_3A_1A', nameEn: 'Class 3A / 1A', nameMs: 'Kelas 3A / 1A', category: CLASS },
        { code: 'K_3B_1CB', nameEn: 'Class 3B / 1CB', nameMs: 'Kelas 3B / 1CB', category: CLASS },
        { code: 'K_3C_1C', nameEn: 'Class 3C / 1C', nameMs: 'Kelas 3C / 1C', category: CLASS },
        { code: 'K_3E_1E', nameEn: 'Class 3E / 1E', nameMs: 'Kelas 3E / 1E', category: CLASS },
        { code: 'K_3G_1G', nameEn: 'Class 3G / 1G', nameMs: 'Kelas 3G / 1G', category: CLASS },
        { code: 'STOR_B1', nameEn: 'Store', nameMs: 'Stor', category: SERVICE },
        { code: 'STOR_B2', nameEn: 'Store', nameMs: 'Stor', category: SERVICE },
        { hallway: true, span: 0.5 },
        { code: 'STOR_KURIKULUM', nameEn: 'Curriculum store', nameMs: 'Stor Kurikulum', category: SERVICE },
        { code: 'SUIS_B', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE },
      ],
      A: [
        { code: 'TANDAS_A', nameEn: 'Toilet (Block A)', nameMs: 'Tandas (Blok A)', category: SERVICE, suffixLevel: true },
        { code: 'BILIK_WUDUK', nameEn: 'Ablution room', nameMs: 'Bilik Wuduk', category: ADMIN },
        { code: 'SURAU_MURID', nameEn: 'Student prayer room', nameMs: 'Surau Murid', category: ADMIN },
        { code: 'SBC_BCINA', nameEn: 'Chinese language resource room', nameMs: 'SBC B.Cina', category: SPECIAL },
        { code: 'SBC_PISLAM', nameEn: 'Islamic & moral studies room', nameMs: 'SBC P.Islam / P.Moral', category: SPECIAL },
        { code: 'K_4K3', nameEn: 'Class 4K3 / 2C', nameMs: 'Kelas 4K3 / 2C', category: CLASS },
        { code: 'K_4K4', nameEn: 'Class 4K4 / 2B', nameMs: 'Kelas 4K4 / 2B', category: CLASS },
        { code: 'K_4K5', nameEn: 'Class 4K5 / 2A', nameMs: 'Kelas 4K5 / 2A', category: CLASS },
        { code: 'S_REDAKSI', nameEn: 'Editorial room', nameMs: 'Bilik S.Redaksi', category: ADMIN },
        { code: 'SUIS_A', nameEn: 'Switch room', nameMs: 'Bilik Suis', category: SERVICE },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Ground-level grounds
// ---------------------------------------------------------------------------

/**
 * Everything outside the teaching blocks exists on the ground level only.
 * The upper plans draw these as BUMBUNG (roof) precisely because you cannot
 * walk onto them from up there, and the graph has to agree.
 */
interface OutdoorSpec {
  code: string;
  nameEn: string;
  nameMs: string;
  category: MapNodeCategory;
  kind?: MapNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

const GROUNDS: OutdoorSpec[] = [
  { code: 'PADANG', nameEn: 'Field', nameMs: 'Padang', category: MapNodeCategory.LANDSCAPE, x: 74, y: 592, width: 76, height: 935 },
  { code: 'KANTIN', nameEn: 'Canteen', nameMs: 'Kantin', category: MapNodeCategory.STAIR_BLOCK, x: 1915, y: 460, width: 90, height: 670 },
  { code: 'MAKMAL_BESTARI', nameEn: 'Smart Lab', nameMs: 'Makmal Bestari', category: MapNodeCategory.STAIR_BLOCK, x: 232, y: 949, width: 205, height: 222 },
  { code: 'DATARAN', nameEn: 'Assembly square & visitor parking', nameMs: 'Dataran Perhimpunan & Parkir', category: MapNodeCategory.OPEN_AREA, x: 1025, y: 949, width: 1310, height: 222 },
  { code: 'ASTAKA', nameEn: 'ASEAN pavilion', nameMs: 'Astaka ASEAN', category: MapNodeCategory.STAIR_BLOCK, x: 1778, y: 949, width: 133, height: 222 },
  { code: 'BENGKEL_RBT', nameEn: 'Design & technology workshop', nameMs: 'Bengkel RBT', category: MapNodeCategory.STAIR_BLOCK, x: 1026, y: 1145, width: 1077, height: 70 },
  // Gate A and the guard house are the same way in: you pass the hut to reach
  // the gate, so the plan stacks them and the graph chains them.
  { code: 'PONDOK_PENGAWAL', nameEn: 'Guard house', nameMs: 'Pondok Pengawal', category: MapNodeCategory.STAIR_BLOCK, kind: MapNodeKind.GATE, x: 249, y: 1284, width: 200, height: 64 },
  { code: 'PINTU_A', nameEn: 'Main entrance (Gate A)', nameMs: 'Pintu Masuk Utama (Pintu A)', category: MapNodeCategory.ADMIN, kind: MapNodeKind.GATE, x: 249, y: 1366, width: 200, height: 64 },
  { code: 'PINTU_B', nameEn: 'Second entrance (Gate B)', nameMs: 'Pintu B (Pintu Kedua)', category: MapNodeCategory.ADMIN, kind: MapNodeKind.GATE, x: 1709, y: 1296, width: 252, height: 68 },
];

/** Where a visitor's route starts unless they say otherwise. */
export const DEFAULT_ORIGIN_CODE = 'G.PONDOK_PENGAWAL';

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

export interface PlanNode {
  code: string;
  levelCode: string;
  kind: MapNodeKind;
  category: MapNodeCategory;
  nameEn: string | null;
  nameMs: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  block: string | null;
}

export interface PlanEdge {
  fromCode: string;
  toCode: string;
  kind: MapEdgeKind;
  weight: number;
}

export interface CampusPlan {
  levels: { code: string; ordinal: number; nameEn: string; nameMs: string }[];
  nodes: PlanNode[];
  edges: PlanEdge[];
}

const distance = (a: PlanNode, b: PlanNode): number =>
  Math.hypot(a.x - b.x, a.y - b.y) * MAP_METRES_PER_UNIT;

/**
 * Expand the transcription into the graph that gets stored.
 *
 * Deterministic: same input, same node codes, same edge set. The seed relies on
 * that to be re-runnable, and the tests rely on it to assert on named nodes.
 */
export function buildCampusPlan(): CampusPlan {
  const nodes = new Map<string, PlanNode>();
  const edges: PlanEdge[] = [];

  const add = (node: PlanNode): PlanNode => {
    if (nodes.has(node.code)) {
      throw new Error(`Duplicate map node code: ${node.code}`);
    }
    nodes.set(node.code, node);
    return node;
  };

  const link = (fromCode: string, toCode: string, kind: MapEdgeKind = MapEdgeKind.WALK, weight?: number) => {
    const from = nodes.get(fromCode);
    const to = nodes.get(toCode);
    if (!from || !to) {
      throw new Error(`Edge references a missing node: ${fromCode} -> ${toCode}`);
    }
    edges.push({ fromCode, toCode, kind, weight: weight ?? distance(from, to) });
  };

  const junction = (code: string, levelCode: string, x: number, y: number): PlanNode =>
    add({
      code,
      levelCode,
      kind: MapNodeKind.JUNCTION,
      category: MapNodeCategory.CIRCULATION,
      nameEn: null,
      nameMs: null,
      x,
      y,
      width: null,
      height: null,
      block: null,
    });

  for (const level of CAMPUS_LEVELS) {
    const L = level.code;
    // Doors that open onto the main covered walkway rather than a block corridor.
    const southDoors: { code: string; x: number }[] = [];
    // Gaps in Block B's row that reach the walkway on its far side.
    const hallways: { code: string; x: number }[] = [];

    // --- Blocks: rooms and the corridor they open onto ----------------------
    for (const blockId of ['A', 'B', 'C'] as BlockId[]) {
      const geometry = BLOCKS[blockId];
      const rooms = level.blocks[blockId];
      const totalSpan = rooms.reduce((sum, room) => sum + (room.span ?? 1), 0);
      const unit = (STRIP_X1 - STRIP_X0) / totalSpan;

      // Corridor spine. Ends first, then the tower junctions, then every door.
      const spine: { code: string; x: number }[] = [];

      const westCode = `${L}.${blockId}.COR.W`;
      const eastCode = `${L}.${blockId}.COR.E`;
      junction(westCode, L, CORRIDOR_W, geometry.corridorY);
      junction(eastCode, L, CORRIDOR_E, geometry.corridorY);
      spine.push({ code: westCode, x: CORRIDOR_W }, { code: eastCode, x: CORRIDOR_E });

      for (const towerX of [TOWER_W_X, TOWER_E_X]) {
        const code = `${L}.${blockId}.COR.T${towerX === TOWER_W_X ? 'W' : 'E'}`;
        junction(code, L, towerX, geometry.corridorY);
        spine.push({ code, x: towerX });
      }

      let cursor = STRIP_X0;
      for (const entry of rooms) {
        const width = (entry.span ?? 1) * unit;
        const centreX = cursor + width / 2;
        cursor += width;

        if (isHallway(entry)) {
          // Nothing is drawn here. The two nodes are the mouth of the passage on
          // the corridor side and its far end at the room line.
          const hallCode = `${L}.${blockId}.HALL`;
          junction(hallCode, L, centreX, geometry.roomY);
          const mouthCode = `${hallCode}.MOUTH`;
          junction(mouthCode, L, centreX, geometry.corridorY);
          link(hallCode, mouthCode);
          spine.push({ code: mouthCode, x: centreX });
          hallways.push({ code: hallCode, x: centreX });
          continue;
        }

        const room = entry;
        const roomCode = `${L}.${blockId}.${room.code}`;
        add({
          code: roomCode,
          levelCode: L,
          kind: MapNodeKind.ROOM,
          category: room.category,
          nameEn: room.suffixLevel ? `${room.nameEn} ${level.shortEn}` : room.nameEn,
          nameMs: room.suffixLevel ? `${room.nameMs} ${level.shortMs}` : room.nameMs,
          x: centreX,
          y: geometry.roomY,
          width,
          height: geometry.roomHeight,
          block: blockId,
        });

        // One door per room. Two would let a route pass through the room to
        // reach the walkway on the other side, which is exactly the thing a
        // visitor cannot do.
        const doorCode = `${roomCode}.DOOR`;
        if (room.doorSide === 'south') {
          junction(doorCode, L, centreX, MAIN_WALK_Y);
          link(roomCode, doorCode);
          southDoors.push({ code: doorCode, x: centreX });
        } else {
          junction(doorCode, L, centreX, geometry.corridorY);
          link(roomCode, doorCode);
          spine.push({ code: doorCode, x: centreX });
        }
      }

      // Chain the spine west to east so the drawn route follows the corridor.
      spine.sort((a, b) => a.x - b.x);
      for (let i = 1; i < spine.length; i += 1) {
        link(spine[i - 1]!.code, spine[i]!.code);
      }
    }

    // --- Stair towers -------------------------------------------------------
    for (const tower of TOWERS) {
      const code = `${L}.${tower.code}`;
      add({
        code,
        levelCode: L,
        kind: MapNodeKind.STAIR,
        category: MapNodeCategory.STAIR_BLOCK,
        nameEn: tower.nameEn,
        nameMs: tower.nameMs,
        x: tower.x,
        y: tower.y,
        width: 130,
        height: 70,
        block: null,
      });

      // On its own level a tower is simply the walkway between two blocks.
      for (const blockId of tower.links) {
        const side = tower.x === TOWER_W_X ? 'W' : 'E';
        link(code, `${L}.${blockId}.COR.T${side}`);
      }
    }

    // --- Block B's northern walkway, reached through the hallways ----------
    if (hallways.length > 0) {
      const northWalk = [
        { code: `${L}.NORTH_B.W`, x: TOWER_W_X },
        { code: `${L}.NORTH_B.E`, x: TOWER_E_X },
        ...hallways.map((hall) => ({ code: `${L}.NORTH_B.HALL`, x: hall.x })),
      ].sort((a, b) => a.x - b.x);

      for (const point of northWalk) junction(point.code, L, point.x, NORTH_B_WALK_Y);
      for (let i = 1; i < northWalk.length; i += 1) link(northWalk[i - 1]!.code, northWalk[i]!.code);

      for (const hall of hallways) link(hall.code, `${L}.NORTH_B.HALL`);
      link(`${L}.NORTH_B.W`, `${L}.TANGGA_D`);
      link(`${L}.NORTH_B.E`, `${L}.TANGGA_C`);
    }

    // --- West and east flank walkways --------------------------------------
    //
    // The eastern walkway is the way to the canteen, and the canteen is on the
    // ground. Above it the plan shows only the canteen's roof, so carrying the
    // walkway upstairs would offer a long way round Block B that a visitor
    // cannot actually take - and, being shorter on paper than the hallway,
    // routing would keep choosing it.
    const flanks = (
      [
        ['W', WEST_STRIP_X, 'W'],
        ['E', EAST_STRIP_X, 'E'],
      ] as const
    ).filter(([side]) => side === 'W' || level.ordinal === 0);

    for (const [side, x, end] of flanks) {
      const strip = (['C', 'B', 'A'] as BlockId[]).map((blockId) => {
        const code = `${L}.STRIP_${side}.${blockId}`;
        junction(code, L, x, BLOCKS[blockId].corridorY);
        link(code, `${L}.${blockId}.COR.${end}`);
        return code;
      });
      for (let i = 1; i < strip.length; i += 1) {
        link(strip[i - 1]!, strip[i]!);
      }
    }

    // --- Main covered walkway along the south face of Block A --------------
    const mainWalkJunctions = [
      { code: `${L}.MAIN.W`, x: CORRIDOR_W },
      { code: `${L}.MAIN.J_BESTARI`, x: 232 },
      { code: `${L}.MAIN.J_GATE`, x: 474 },
      { code: `${L}.MAIN.J_DATARAN`, x: 1026 },
      { code: `${L}.MAIN.J_ASTAKA`, x: 1778 },
      { code: `${L}.MAIN.E`, x: CORRIDOR_E },
    ];
    for (const point of mainWalkJunctions) junction(point.code, L, point.x, MAIN_WALK_Y);

    const mainWalk = [...mainWalkJunctions, ...southDoors].sort((a, b) => a.x - b.x);
    for (let i = 1; i < mainWalk.length; i += 1) link(mainWalk[i - 1]!.code, mainWalk[i]!.code);

    // The main walkway hangs off the Block A corridor at both ends.
    link(`${L}.MAIN.W`, `${L}.A.COR.W`);
    link(`${L}.MAIN.E`, `${L}.A.COR.E`);
  }

  // --- Stairs between levels ------------------------------------------------
  for (let i = 1; i < CAMPUS_LEVELS.length; i += 1) {
    const below = CAMPUS_LEVELS[i - 1]!;
    const above = CAMPUS_LEVELS[i]!;
    for (const tower of TOWERS) {
      link(`${below.code}.${tower.code}`, `${above.code}.${tower.code}`, MapEdgeKind.STAIR, STAIR_WEIGHT_METRES);
    }
  }

  // --- Ground level grounds -------------------------------------------------
  for (const place of GROUNDS) {
    add({
      code: `G.${place.code}`,
      levelCode: 'G',
      kind: place.kind ?? MapNodeKind.ROOM,
      category: place.category,
      nameEn: place.nameEn,
      nameMs: place.nameMs,
      x: place.x,
      y: place.y,
      width: place.width,
      height: place.height,
      block: null,
    });
  }

  // The vehicle way and footpath that runs inside the fence, linking the gates.
  const gateWalk = [
    { code: 'G.GATE.W', x: 249 },
    { code: 'G.GATE.MAIN', x: 474 },
    { code: 'G.GATE.MID', x: 1026 },
    { code: 'G.GATE.E', x: 1709 },
  ];
  for (const point of gateWalk) junction(point.code, 'G', point.x, 1222);
  for (let i = 1; i < gateWalk.length; i += 1) link(gateWalk[i - 1]!.code, gateWalk[i]!.code);

  link('G.PINTU_A', 'G.PONDOK_PENGAWAL');
  link('G.PONDOK_PENGAWAL', 'G.GATE.W');
  link('G.PINTU_B', 'G.GATE.E');

  // Up the west flank of the workshop into the assembly square, then onto the
  // covered walkway that serves all three blocks.
  junction('G.DATARAN.W', 'G', 474, 1000);
  junction('G.DATARAN.E', 'G', 1709, 1000);
  link('G.GATE.MAIN', 'G.DATARAN.W');
  link('G.GATE.E', 'G.DATARAN.E');
  link('G.DATARAN.W', 'G.DATARAN');
  link('G.DATARAN.E', 'G.DATARAN');
  link('G.DATARAN', 'G.MAIN.J_DATARAN');
  link('G.DATARAN.E', 'G.ASTAKA');
  link('G.ASTAKA', 'G.MAIN.J_ASTAKA');
  link('G.MAKMAL_BESTARI', 'G.MAIN.J_BESTARI');

  // Covered walkway down to the workshop.
  junction('G.RBT.WALK', 'G', 1026, 1092);
  link('G.DATARAN', 'G.RBT.WALK');
  link('G.RBT.WALK', 'G.BENGKEL_RBT');

  // Field and canteen hang off the flank walkways.
  junction('G.PADANG.GATE', 'G', WEST_STRIP_X, 592);
  link('G.PADANG.GATE', 'G.STRIP_W.B');
  link('G.PADANG.GATE', 'G.PADANG');

  junction('G.KANTIN.GATE', 'G', EAST_STRIP_X, 460);
  link('G.KANTIN.GATE', 'G.STRIP_E.B');
  link('G.KANTIN.GATE', 'G.KANTIN');

  return {
    levels: CAMPUS_LEVELS.map(({ code, ordinal, nameEn, nameMs }) => ({ code, ordinal, nameEn, nameMs })),
    nodes: [...nodes.values()],
    edges,
  };
}

/**
 * Destination code -> map node code.
 *
 * Kept beside the plan because it is the same act of transcription: reading the
 * school's floor plan and deciding which room the reception desk means when it
 * says "the office".
 */
export const DESTINATION_MAP_NODES: Record<string, string> = {
  OFFICE: 'L1.A.PEJABAT_AM',
  COUNSEL: 'L2.A.BILIK_UBK',
  STAFFRM: 'L1.A.BILIK_GURU',
  HALL: 'G.A.DEWAN',
  LIBRARY: 'L1.B.PSS',
  LABSCI: 'G.B.MAKMAL_A',
  CANTEEN: 'G.KANTIN',
};
