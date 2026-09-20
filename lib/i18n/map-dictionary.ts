import type { Locale } from '@/lib/constants';
import type { RouteStep } from '@/lib/map/route';

/**
 * Wayfinding strings.
 *
 * Kept apart from `GuardDictionary` because the audience is different: the gate
 * dictionary is written for a guard who uses the system every day, this one for
 * a visitor reading a screen once. Both are hand-authored in Bahasa Melayu and
 * English for the same reason - a mistranslated direction sends someone into a
 * part of the school they should not be in.
 *
 * Everything here is a plain string. The object crosses into a Client
 * Component, and a function cannot make that trip; `renderRouteStep` below is
 * separate for exactly that reason.
 */

export interface MapDictionary {
  title: string;
  subtitle: string;
  youAreAt: string;
  whereTo: string;
  whichEnd: string;
  startingPoint: string;
  destination: string;
  notChosen: string;
  chooseStart: string;
  chooseDestination: string;
  tapToSetStart: string;
  tapToSetDestination: string;
  needBothEnds: string;
  zoomIn: string;
  zoomOut: string;
  search: string;
  searchPlaceholder: string;
  noMatches: string;
  clear: string;
  pickPrompt: string;
  directions: string;
  distance: string;
  walkMinutes: string;
  level: string;
  levelsOnRoute: string;
  showingLevel: string;
  routeOnAnotherLevel: string;
  unreachable: string;
  mapUnavailable: string;
  legend: string;
  categories: Record<string, string>;
}

const en: MapDictionary = {
  title: 'Find your way',
  subtitle: 'Choose where you are starting from and where you are going.',
  youAreAt: 'You are at',
  whereTo: 'Where do you want to go?',
  whichEnd: 'Which end of the journey to set',
  startingPoint: 'Starting point',
  destination: 'Destination',
  notChosen: 'Not chosen',
  chooseStart: 'Choose where you are starting from',
  chooseDestination: 'Choose where you are going',
  tapToSetStart: 'Tap a room on the plan to set your starting point.',
  tapToSetDestination: 'Tap a room on the plan to set your destination.',
  needBothEnds: 'Choose a starting point and a destination to see the route.',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  search: 'Search',
  searchPlaceholder: 'Search for a room, block or class',
  noMatches: 'No place matches that search.',
  clear: 'Start again',
  pickPrompt: 'Pick a destination to see the walking route.',
  directions: 'Directions',
  distance: 'Distance',
  walkMinutes: 'min walk',
  level: 'Level',
  levelsOnRoute: 'This route uses more than one level.',
  showingLevel: 'Showing',
  routeOnAnotherLevel: 'The route does not pass through this level.',
  unreachable: 'There is no walking route between those two places.',
  mapUnavailable:
    'The school map is not available right now. Please ask at the guard house for directions.',
  legend: 'Legend',
  categories: {
    CLASSROOM: 'Classroom',
    SPECIAL_ROOM: 'Laboratory / special room',
    ADMIN: 'Administration & staff',
    STAIR_BLOCK: 'Stairs & special buildings',
    SERVICE: 'Store, toilets & services',
    CIRCULATION: 'Corridor & walkway',
    OPEN_AREA: 'Open area & sports',
    LANDSCAPE: 'Landscaping & garden',
  },
};

const ms: MapDictionary = {
  title: 'Cari arah',
  subtitle: 'Pilih tempat anda bermula dan tempat yang anda tuju.',
  youAreAt: 'Anda berada di',
  whereTo: 'Anda hendak ke mana?',
  whichEnd: 'Hujung perjalanan yang hendak ditetapkan',
  startingPoint: 'Tempat mula',
  destination: 'Destinasi',
  notChosen: 'Belum dipilih',
  chooseStart: 'Pilih tempat anda bermula',
  chooseDestination: 'Pilih tempat yang anda tuju',
  tapToSetStart: 'Tap satu bilik pada pelan untuk menetapkan tempat mula.',
  tapToSetDestination: 'Tap satu bilik pada pelan untuk menetapkan destinasi.',
  needBothEnds: 'Pilih tempat mula dan destinasi untuk melihat laluan.',
  zoomIn: 'Zum masuk',
  zoomOut: 'Zum keluar',
  search: 'Cari',
  searchPlaceholder: 'Cari bilik, blok atau kelas',
  noMatches: 'Tiada tempat sepadan dengan carian itu.',
  clear: 'Mula semula',
  pickPrompt: 'Pilih destinasi untuk melihat laluan berjalan kaki.',
  directions: 'Arah perjalanan',
  distance: 'Jarak',
  walkMinutes: 'min berjalan',
  level: 'Aras',
  levelsOnRoute: 'Laluan ini melalui lebih daripada satu aras.',
  showingLevel: 'Memaparkan',
  routeOnAnotherLevel: 'Laluan ini tidak melalui aras ini.',
  unreachable: 'Tiada laluan pejalan kaki antara dua tempat itu.',
  mapUnavailable:
    'Peta sekolah tidak tersedia buat masa ini. Sila bertanya di pondok pengawal untuk arah.',
  legend: 'Petunjuk',
  categories: {
    CLASSROOM: 'Bilik darjah / kelas',
    SPECIAL_ROOM: 'Makmal & bilik khas',
    ADMIN: 'Pentadbiran & bilik guru',
    STAIR_BLOCK: 'Tangga & bangunan khas',
    SERVICE: 'Stor, tandas & suis',
    CIRCULATION: 'Koridor & laluan',
    OPEN_AREA: 'Kawasan terbuka & sukan',
    LANDSCAPE: 'Landskap & taman',
  },
};

const DICTIONARIES: Record<Locale, MapDictionary> = { en, ms };

export function getMapDictionary(locale: Locale): MapDictionary {
  return DICTIONARIES[locale] ?? en;
}

/**
 * Render one routing step as a sentence.
 *
 * Kept out of `MapDictionary` because that object is handed to a Client
 * Component, and a function cannot cross that boundary. The written directions
 * are rendered on the server anyway, which is where this belongs.
 */
export function renderRouteStep(locale: Locale, step: RouteStep, levelName: string): string {
  if (locale === 'ms') {
    switch (step.kind) {
      case 'start':
        return `Mula dari ${step.place}.`;
      case 'straight':
        return `Jalan lurus lebih kurang ${step.metres} m.`;
      case 'left':
        return `Jalan lebih kurang ${step.metres} m, kemudian belok kiri.`;
      case 'right':
        return `Jalan lebih kurang ${step.metres} m, kemudian belok kanan.`;
      case 'stairs':
        return `Naik ${step.place} ke ${levelName}.`;
      case 'arrive':
        return step.metres === null
          ? `Anda telah sampai di ${step.place}.`
          : `Jalan lebih kurang ${step.metres} m. Anda telah sampai di ${step.place}.`;
    }
  }

  switch (step.kind) {
    case 'start':
      return `Start at ${step.place}.`;
    case 'straight':
      return `Walk straight for about ${step.metres} m.`;
    case 'left':
      return `Walk about ${step.metres} m, then turn left.`;
    case 'right':
      return `Walk about ${step.metres} m, then turn right.`;
    case 'stairs':
      return `Take ${step.place} to ${levelName}.`;
    case 'arrive':
      return step.metres === null
        ? `You have arrived at ${step.place}.`
        : `Walk about ${step.metres} m. You have arrived at ${step.place}.`;
  }
}
