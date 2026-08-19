import type { Metadata } from 'next';
import { BlacklistStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAdminister, requireOversight } from '@/lib/auth/authorize';
import { expireLapsedEntries } from '@/lib/domain/blacklist';
import { setBlacklistStatusAction } from '@/app/admin/actions';
import { formatDate, formatDateTime } from '@/lib/time';
import { maskEmail, maskPhone } from '@/lib/domain/contact';
import { Alert, Card, EmptyState, PageHeading, Pill, TableScroll } from '@/components/ui/surface';
import { ActionForm } from '@/components/action-form';
import { BlacklistCreateForm } from './create-form';

export const metadata: Metadata = { title: 'Blacklist' };
export const dynamic = 'force-dynamic';

export default async function BlacklistPage() {
  const user = await requireOversight('/admin/blacklist');
  // A principal reads this list; only an administrator maintains it.
  const mayAct = canAdminister(user.role);

  // Opportunistically retire entries whose window has closed, so the list
  // never shows an "active" rule that no longer applies.
  await expireLapsedEntries();

  const entries = await prisma.blacklistEntry.findMany({
    include: {
      createdBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });

  return (
    <>
      <PageHeading
        title="Blacklist"
        description="Rules that block or flag a visitor. Guards never see the reason, only the outcome."
      />

      <div className="mb-5">
        <Alert tone="info" title="How matching works">
          An identity number, phone or email must be supplied - a name alone is never matched
          automatically, because common Malaysian names would deny entry to the wrong person.
          <strong> Block</strong> stops approval and check-in outright. <strong>Review</strong> holds
          the request for an administrator without telling the visitor or the guard why.
        </Alert>
      </div>

      <div className={mayAct ? 'grid gap-5 lg:grid-cols-[1fr_1.4fr]' : 'grid gap-5'}>
        {mayAct ? (
          <Card className="p-5">
            <h2 className="text-base font-semibold">Add an entry</h2>
            <BlacklistCreateForm />
          </Card>
        ) : null}

        <Card>
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold">Entries</h2>
            <p className="mt-0.5 text-sm text-muted">{entries.length} recorded</p>
          </div>

          {entries.length === 0 ? (
            <EmptyState
              title="No blacklist entries"
              description="Entries you add will appear here with their full history."
            />
          ) : (
            <TableScroll>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Blacklist entries</caption>
                <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Name</th>
                    <th scope="col" className="px-4 py-3 font-medium">Matches on</th>
                    <th scope="col" className="px-4 py-3 font-medium">Policy</th>
                    <th scope="col" className="px-4 py-3 font-medium">Effective</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line-soft)]">
                  {entries.map((entry) => {
                    const matches = [
                      entry.identityHmac ? 'identity number' : null,
                      entry.matchPhone ? maskPhone(entry.matchPhone) : null,
                      entry.matchEmail ? maskEmail(entry.matchEmail) : null,
                    ].filter(Boolean);

                    return (
                      <tr key={entry.id} className="align-top">
                        <td className="px-4 py-3">
                          <span className="block font-medium text-[var(--text-strong)]">
                            {entry.displayName}
                          </span>
                          <span className="block text-xs text-muted">
                            {entry.category.replace(/_/g, ' ').toLowerCase()}
                          </span>
                          {/*
                            The reason is restricted internal text - safeguarding,
                            custody, incident detail - and often concerns someone
                            who is not the visitor. Oversight needs to see that an
                            entry exists and what it does, not why it was written.
                          */}
                          {mayAct ? (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-xs text-[var(--accent)]">
                                Internal reason
                              </summary>
                              <p className="mt-1 max-w-xs text-xs text-muted">{entry.reason}</p>
                            </details>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {matches.length > 0 ? matches.join(', ') : 'none'}
                        </td>
                        <td className="px-4 py-3">
                          <Pill tone={entry.matchPolicy === 'BLOCK' ? 'danger' : 'warning'}>
                            {entry.matchPolicy}
                          </Pill>
                        </td>
                        <td className="px-4 py-3 text-xs whitespace-nowrap">
                          <span className="block">From {formatDate(entry.validFrom)}</span>
                          <span className="block text-muted">
                            {entry.validUntil ? `Until ${formatDate(entry.validUntil)}` : 'No end date'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Pill
                            tone={
                              entry.status === BlacklistStatus.ACTIVE
                                ? 'danger'
                                : entry.status === BlacklistStatus.EXPIRED
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {entry.status}
                          </Pill>
                          {entry.reviewedAt ? (
                            <span className="mt-1 block text-xs text-muted">
                              Reviewed {formatDateTime(entry.reviewedAt)}
                              {entry.reviewedBy ? ` by ${entry.reviewedBy.name}` : ''}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {!mayAct ? (
                            <span className="text-xs text-muted">-</span>
                          ) : entry.status === BlacklistStatus.ACTIVE ? (
                            <ActionForm
                              action={setBlacklistStatusAction}
                              hidden={{ entryId: entry.id, status: 'INACTIVE' }}
                              submitLabel="Deactivate"
                              variant="secondary"
                              confirm="Deactivate this blacklist entry?"
                            />
                          ) : (
                            <ActionForm
                              action={setBlacklistStatusAction}
                              hidden={{ entryId: entry.id, status: 'ACTIVE' }}
                              submitLabel="Reactivate"
                              variant="secondary"
                              confirm="Reactivate this blacklist entry?"
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>
      </div>
    </>
  );
}
