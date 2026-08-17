import { maskIdentity } from '@/lib/crypto/identity';
import { maskPhone } from '@/lib/domain/contact';
import { Card, TableScroll } from '@/components/ui/surface';
import type { IdentityType } from '@prisma/client';

/**
 * The people arriving alongside the main visitor.
 *
 * Shown to guards, hosts and administrators because knowing *who* is on the
 * grounds is the point of recording them - a party size alone is useless during
 * an evacuation or an incident.
 *
 * Identity numbers are masked here as everywhere else. There is no reveal for a
 * companion: the audited reveal exists for the visitor a decision was made
 * about, and extending it to accompanying people would widen the exposure of
 * identity data for no operational gain.
 */

export interface CompanionRow {
  id: string;
  fullName: string;
  relation: string;
  phone: string | null;
  identityType: IdentityType;
  identityLast4: string;
}

export function CompanionList({
  companions,
  title = 'Accompanying visitors',
  className,
}: {
  companions: CompanionRow[];
  title?: string;
  className?: string;
}) {
  if (companions.length === 0) return null;

  return (
    <Card className={className}>
      <div className="border-b border-[var(--line-soft)] px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted">
          {companions.length} {companions.length === 1 ? 'person' : 'people'} arriving with the main
          visitor.
        </p>
      </div>

      <TableScroll>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" className="px-5 py-3">
                Name
              </th>
              <th scope="col" className="px-5 py-3">
                Relationship
              </th>
              <th scope="col" className="px-5 py-3 whitespace-nowrap">
                Identification
              </th>
              <th scope="col" className="px-5 py-3 whitespace-nowrap">
                Phone
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line-soft)]">
            {companions.map((companion) => (
              <tr key={companion.id}>
                <td className="px-5 py-3 font-medium text-[var(--text-strong)]">
                  {companion.fullName}
                </td>
                <td className="px-5 py-3">{companion.relation}</td>
                <td className="px-5 py-3 font-mono whitespace-nowrap">
                  {maskIdentity(companion.identityType, companion.identityLast4)}
                </td>
                <td className="px-5 py-3 whitespace-nowrap">{maskPhone(companion.phone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}

/** The Prisma `select` producing exactly the fields this component needs. */
export const COMPANION_SELECT = {
  id: true,
  fullName: true,
  relation: true,
  phone: true,
  identityType: true,
  identityLast4: true,
} as const;
