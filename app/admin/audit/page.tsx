import type { Metadata } from 'next';
import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/authorize';
import { AUDIT_ACTIONS, DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDateTime } from '@/lib/time';
import { Alert, Card, EmptyState, PageHeading, TableScroll } from '@/components/ui/surface';
import { Pagination } from '@/components/pagination';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

const ACTION_VALUES = Object.values(AUDIT_ACTIONS);

/**
 * Audit viewer.
 *
 * Read-only by construction: this page renders no edit or delete control, and
 * no server action exists that would mutate an audit row. The log is written
 * by the services that perform each action and is never modified afterwards.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  await requireAdmin('/admin/audit');
  const params = await searchParams;

  const action = params.action && ACTION_VALUES.includes(params.action as never)
    ? params.action
    : undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);

  const where: Prisma.AuditLogWhereInput = action ? { action } : {};

  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
  ]);

  return (
    <>
      <PageHeading
        title="Audit log"
        description="Append-only record of security-relevant actions. Entries cannot be edited or deleted."
      />

      <div className="mb-5">
        <Alert tone="info">
          Metadata is scrubbed before it is stored: passwords, session and QR tokens, full identity
          numbers and blacklist reasons are never written here.
        </Alert>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-action" className="text-xs font-medium text-muted">
            Filter by action
          </label>
          <select
            id="audit-action"
            name="action"
            defaultValue={action ?? ''}
            className="h-11 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-card)] px-3 text-sm"
          >
            <option value="">All actions</option>
            {ACTION_VALUES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="flex h-11 items-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-text)]"
        >
          Apply
        </button>
        {action ? (
          <Link
            href="/admin/audit"
            className="flex h-11 items-center rounded-lg border border-[var(--line-strong)] px-4 text-sm font-medium"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <Card>
        {entries.length === 0 ? (
          <EmptyState title="No audit entries match this filter" />
        ) : (
          <TableScroll>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Audit log</caption>
              <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                  <th scope="col" className="px-4 py-3 font-medium">Actor</th>
                  <th scope="col" className="px-4 py-3 font-medium">Action</th>
                  <th scope="col" className="px-4 py-3 font-medium">Target</th>
                  <th scope="col" className="px-4 py-3 font-medium">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line-soft)]">
                {entries.map((entry) => (
                  <tr key={entry.id} className="align-top">
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {entry.actor ? (
                        <>
                          <span className="block">{entry.actor.name}</span>
                          <span className="block text-xs text-muted">{entry.actor.role}</span>
                        </>
                      ) : (
                        <span className="text-muted">System / public</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{entry.action}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className="block">{entry.targetType}</span>
                      {entry.targetId ? (
                        <span className="block font-mono text-muted">
                          {entry.targetId.slice(0, 12)}...
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {/*
                        max-w-md is 448px, which is wider than a phone, so the
                        width is capped by the viewport first and only widens
                        once there is room.
                      */}
                      {entry.metadata ? (
                        <pre className="w-full max-w-full min-w-0 overflow-x-auto rounded bg-[var(--surface-inset)] p-2 text-xs sm:max-w-md">
                          {JSON.stringify(entry.metadata, null, 1)}
                        </pre>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Pagination
        page={page}
        total={total}
        pageSize={DEFAULT_PAGE_SIZE}
        basePath="/admin/audit"
        query={{ action }}
      />
    </>
  );
}
