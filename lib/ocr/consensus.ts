/**
 * Combine several independent readings of the same card into one.
 *
 * This is the one accuracy gain a live camera offers that a chosen photograph
 * cannot. OCR error on a marginal frame is largely *random*: the same glare
 * pushes different frames to different wrong answers, because the sensor noise,
 * the hand shake and the exposure all differ frame to frame. Two frames landing
 * on the same twelve digits by coincidence is vanishingly unlikely, so
 * agreement is real evidence in a way that any single frame's own confidence is
 * not.
 *
 * The reverse is the useful half: when the frames *disagree*, that is proof the
 * read is unreliable, and it is proof no single frame could ever have provided.
 * Disagreement is reported rather than hidden behind whichever frame happened
 * to look most confident.
 *
 * Kept pure so the voting can be tested without a camera.
 */

import type { ParsedIcFields } from '@/lib/ocr/parse-ic';

export interface FrameReading {
  fields: ParsedIcFields;
  /** The recognizer's own mean confidence for the frame, 0-100. */
  confidence: number;
}

/** How many frames must agree before a value counts as corroborated. */
const AGREEMENT = 2;

interface Tally {
  value: string;
  votes: number;
  /** Summed confidence, used only to break a tie in votes. */
  weight: number;
  /** True when at least one contributing frame did *not* doubt the value. */
  trustedOnce: boolean;
}

/**
 * Count the distinct non-null values for one field.
 *
 * Comparison is on the exact string. For the identity number that is the only
 * sane choice - two numbers differing by a digit are different numbers, and
 * treating them as near-matches is how a wrong digit gets averaged into an
 * answer nobody read.
 */
function tally(
  readings: FrameReading[],
  field: 'identityNumber' | 'fullName',
): Tally[] {
  const counts = new Map<string, Tally>();

  for (const reading of readings) {
    const value = reading.fields[field];
    if (!value) continue;

    const existing = counts.get(value);
    const doubted = reading.fields.uncertain.includes(field);

    if (existing) {
      existing.votes += 1;
      existing.weight += reading.confidence;
      existing.trustedOnce = existing.trustedOnce || !doubted;
    } else {
      counts.set(value, {
        value,
        votes: 1,
        weight: reading.confidence,
        trustedOnce: !doubted,
      });
    }
  }

  return [...counts.values()];
}

/** Most votes wins; equal votes fall back to the recognizer's confidence. */
function winner(tallies: Tally[]): Tally | null {
  if (tallies.length === 0) return null;

  return tallies.reduce((best, candidate) => {
    if (candidate.votes !== best.votes) return candidate.votes > best.votes ? candidate : best;
    return candidate.weight > best.weight ? candidate : best;
  });
}

export function combineReadings(readings: FrameReading[]): ParsedIcFields {
  const usable = readings.filter(
    (reading) => reading.fields.identityNumber || reading.fields.fullName,
  );

  if (usable.length === 0) {
    return { identityNumber: null, fullName: null, uncertain: [] };
  }

  const uncertain: ParsedIcFields['uncertain'] = [];

  const decide = (field: 'identityNumber' | 'fullName'): string | null => {
    const tallies = tally(usable, field);
    const best = winner(tallies);
    if (!best) return null;

    /*
     * Three separate reasons to doubt the winner, and any one is enough:
     *
     *  - too few frames agreed, so there is no corroboration;
     *  - another value also appeared, so the frames actively disagreed;
     *  - every frame that produced it doubted it, so agreement is only
     *    agreement about something unconvincing.
     *
     * The middle case is the one worth spelling out. Even a value with a clear
     * majority is suspect if some frame read it differently, because the digits
     * either frame disagreed on are exactly the digits nobody should trust.
     */
    const corroborated = best.votes >= Math.min(AGREEMENT, usable.length);
    const unanimous = tallies.length === 1;

    if (!corroborated || !unanimous || !best.trustedOnce) uncertain.push(field);

    return best.value;
  };

  // Both fields are decided before the result is assembled, so `uncertain` is
  // complete either way round.
  const identityNumber = decide('identityNumber');
  const fullName = decide('fullName');

  return { identityNumber, fullName, uncertain };
}
