import { SettingType } from '@prisma/client';
import { prisma, type Db } from '@/lib/db/prisma';
import { CONSENT_VERSION } from '@/lib/constants';

/**
 * Runtime-configurable school settings.
 *
 * Everything an administrator may reasonably want to change without a code
 * change lives here: opening hours, QR grace windows, the overdue threshold,
 * the badge prefix, retention period. Each key declares its type and default,
 * so a missing or malformed row degrades to a sane value instead of crashing
 * the gate screen.
 */

export interface SettingDefinition {
  key: string;
  type: SettingType;
  defaultValue: string;
  label: string;
  description: string;
  category: 'school' | 'hours' | 'passes' | 'operations' | 'privacy';
}

export const SETTING_DEFINITIONS = {
  'school.name': {
    key: 'school.name',
    type: SettingType.STRING,
    defaultValue: 'SMK Bandar Baru Sri Petaling',
    label: 'School name',
    description: 'Printed on badges, passes, reports and emails.',
    category: 'school',
  },
  'school.shortName': {
    key: 'school.shortName',
    type: SettingType.STRING,
    defaultValue: 'SMKBBSP',
    label: 'Short name',
    description: 'Compact form used where space is tight.',
    category: 'school',
  },
  'hours.open': {
    key: 'hours.open',
    type: SettingType.TIME,
    defaultValue: '07:30',
    label: 'Visiting hours open',
    description: 'Earliest appointment start accepted from the public form.',
    category: 'hours',
  },
  'hours.close': {
    key: 'hours.close',
    type: SettingType.TIME,
    defaultValue: '17:00',
    label: 'Visiting hours close',
    description: 'Latest appointment end accepted from the public form.',
    category: 'hours',
  },
  'hours.openDays': {
    key: 'hours.openDays',
    type: SettingType.STRING,
    defaultValue: '1,2,3,4,5',
    label: 'Open days',
    description: 'Comma-separated weekdays (0 = Sunday). Default is Monday to Friday.',
    category: 'hours',
  },
  'appointment.maxAdvanceDays': {
    key: 'appointment.maxAdvanceDays',
    type: SettingType.INT,
    defaultValue: '60',
    label: 'Maximum days in advance',
    description: 'How far ahead a visitor may book.',
    category: 'hours',
  },
  'appointment.minLeadMinutes': {
    key: 'appointment.minLeadMinutes',
    type: SettingType.INT,
    defaultValue: '60',
    label: 'Minimum notice (minutes)',
    description: 'A request must start at least this far in the future.',
    category: 'hours',
  },
  'qr.graceBeforeMinutes': {
    key: 'qr.graceBeforeMinutes',
    type: SettingType.INT,
    defaultValue: '30',
    label: 'Pass valid before start (minutes)',
    description: 'How early an approved visitor may be scanned in.',
    category: 'passes',
  },
  'qr.graceAfterMinutes': {
    key: 'qr.graceAfterMinutes',
    type: SettingType.INT,
    defaultValue: '30',
    label: 'Pass valid after end (minutes)',
    description: 'How late an approved pass still scans successfully.',
    category: 'passes',
  },
  'badge.prefix': {
    key: 'badge.prefix',
    type: SettingType.STRING,
    defaultValue: 'V',
    label: 'Badge number prefix',
    description: 'Leading segment of every printed badge number.',
    category: 'passes',
  },
  'visit.overdueGraceMinutes': {
    key: 'visit.overdueGraceMinutes',
    type: SettingType.INT,
    defaultValue: '30',
    label: 'Overdue threshold (minutes)',
    description: 'Minutes past the expected end before a visit is flagged overdue.',
    category: 'operations',
  },
  'checkpoint.enabled': {
    key: 'checkpoint.enabled',
    type: SettingType.BOOL,
    defaultValue: 'true',
    label: 'Record arrival confirmations',
    description: 'Let hosts and guards confirm that a visitor reached their destination.',
    category: 'operations',
  },
  'checkpoint.alertsEnabled': {
    key: 'checkpoint.alertsEnabled',
    type: SettingType.BOOL,
    defaultValue: 'false',
    label: 'Alert on unconfirmed arrivals',
    description:
      'Off until staff are reliably confirming arrivals. Turning this on before then would flag ordinary visits, and guards would learn to ignore the panel.',
    category: 'operations',
  },
  'checkpoint.arrivalGraceMinutes': {
    key: 'checkpoint.arrivalGraceMinutes',
    type: SettingType.INT,
    defaultValue: '15',
    label: 'Arrival confirmation window (minutes)',
    description: 'Minutes after check-in before an unconfirmed arrival is flagged.',
    category: 'operations',
  },
  'notify.hostOnCheckout': {
    key: 'notify.hostOnCheckout',
    type: SettingType.BOOL,
    defaultValue: 'false',
    label: 'Email host on check-out',
    description: 'Send the host a notification when their visitor leaves.',
    category: 'operations',
  },
  'privacy.retentionDays': {
    key: 'privacy.retentionDays',
    type: SettingType.INT,
    defaultValue: '365',
    label: 'Record retention (days)',
    description: 'Age at which visit records become eligible for the retention review.',
    category: 'privacy',
  },
  'privacy.consentVersion': {
    key: 'privacy.consentVersion',
    type: SettingType.STRING,
    defaultValue: CONSENT_VERSION,
    label: 'Consent notice version',
    description: 'Recorded against each visitor submission.',
    category: 'privacy',
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

/** Resolved, typed view of every setting. */
export interface SchoolSettings {
  schoolName: string;
  schoolShortName: string;
  /** Minutes since midnight. */
  openMinutes: number;
  closeMinutes: number;
  openDays: number[];
  maxAdvanceDays: number;
  minLeadMinutes: number;
  qrGraceBeforeMinutes: number;
  qrGraceAfterMinutes: number;
  badgePrefix: string;
  overdueGraceMinutes: number;
  checkpointEnabled: boolean;
  checkpointAlertsEnabled: boolean;
  checkpointArrivalGraceMinutes: number;
  notifyHostOnCheckout: boolean;
  retentionDays: number;
  consentVersion: string;
}

function parseTimeToMinutes(value: string, fallback: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return parseTimeToMinutes(fallback, '00:00');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return parseTimeToMinutes(fallback, '00:00');
  return hour * 60 + minute;
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDays(value: string): number[] {
  const days = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  return days.length > 0 ? [...new Set(days)].sort() : [1, 2, 3, 4, 5];
}

/**
 * Load all settings, filling any missing key from its declared default.
 * Never throws for a bad stored value: the gate must keep working.
 */
export async function getSettings(db: Db = prisma): Promise<SchoolSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: SETTING_KEYS } } });
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  const read = (key: SettingKey): string =>
    stored.get(key) ?? SETTING_DEFINITIONS[key].defaultValue;

  return {
    schoolName: read('school.name'),
    schoolShortName: read('school.shortName'),
    openMinutes: parseTimeToMinutes(read('hours.open'), '07:30'),
    closeMinutes: parseTimeToMinutes(read('hours.close'), '17:00'),
    openDays: parseDays(read('hours.openDays')),
    maxAdvanceDays: parseInteger(read('appointment.maxAdvanceDays'), 60),
    minLeadMinutes: parseInteger(read('appointment.minLeadMinutes'), 60),
    qrGraceBeforeMinutes: parseInteger(read('qr.graceBeforeMinutes'), 30),
    qrGraceAfterMinutes: parseInteger(read('qr.graceAfterMinutes'), 30),
    badgePrefix: read('badge.prefix').trim() || 'V',
    overdueGraceMinutes: parseInteger(read('visit.overdueGraceMinutes'), 30),
    checkpointEnabled: read('checkpoint.enabled').toLowerCase() === 'true',
    checkpointAlertsEnabled: read('checkpoint.alertsEnabled').toLowerCase() === 'true',
    checkpointArrivalGraceMinutes: parseInteger(read('checkpoint.arrivalGraceMinutes'), 15),
    notifyHostOnCheckout: read('notify.hostOnCheckout').toLowerCase() === 'true',
    retentionDays: parseInteger(read('privacy.retentionDays'), 365),
    consentVersion: read('privacy.consentVersion'),
  };
}

/** Validate a raw value against its declared type before it is stored. */
export function validateSettingValue(key: SettingKey, value: string): string | null {
  // Widened to the interface so the switch below stays exhaustive over every
  // SettingType, not only the subset currently used by a definition.
  const definition: SettingDefinition = SETTING_DEFINITIONS[key];

  switch (definition.type) {
    case SettingType.INT: {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) return 'Enter a whole number.';
      if (parsed < 0) return 'Value cannot be negative.';
      if (parsed > 100_000) return 'Value is unreasonably large.';
      return null;
    }
    case SettingType.BOOL:
      return ['true', 'false'].includes(value.toLowerCase()) ? null : 'Choose true or false.';
    case SettingType.TIME:
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim()) ? null : 'Use 24-hour HH:MM.';
    case SettingType.STRING:
      if (value.trim().length === 0) return 'Value cannot be empty.';
      if (value.length > 200) return 'Value is too long.';
      if (key === 'hours.openDays' && !/^\s*[0-6](\s*,\s*[0-6])*\s*$/.test(value)) {
        return 'Use comma-separated weekday numbers from 0 to 6.';
      }
      if (key === 'badge.prefix' && !/^[A-Z]{1,4}$/.test(value.trim())) {
        return 'Use 1 to 4 uppercase letters.';
      }
      return null;
    case SettingType.JSON:
      try {
        JSON.parse(value);
        return null;
      } catch {
        return 'Enter valid JSON.';
      }
    default:
      return null;
  }
}

/** Insert every setting that does not yet exist. Used by the seed. */
export async function ensureSettingDefaults(db: Db = prisma): Promise<void> {
  for (const definition of Object.values(SETTING_DEFINITIONS)) {
    await db.setting.upsert({
      where: { key: definition.key },
      create: {
        key: definition.key,
        value: definition.defaultValue,
        type: definition.type,
        label: definition.label,
        description: definition.description,
        category: definition.category,
      },
      // Never clobber an administrator's chosen value; refresh the copy only.
      update: {
        label: definition.label,
        description: definition.description,
        category: definition.category,
        type: definition.type,
      },
    });
  }
}
