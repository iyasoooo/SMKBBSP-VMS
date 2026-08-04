import Link from 'next/link';

/**
 * Server-rendered pagination.
 *
 * Links rather than buttons, so a page is shareable, works without JavaScript,
 * and remains keyboard navigable. Existing filters are carried through `query`
 * so paging never silently resets them.
 */
export function Pagination({
  page,
  total,
  pageSize,
  basePath,
  query = {},
}: {
  page: number;
  total: number;
  pageSize: number;
  basePath: string;
  query?: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const buildHref = (target: number): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
    if (target > 1) params.set('page', String(target));
    const queryString = params.toString();
    return queryString ? `${basePath}?${queryString}` : basePath;
  };

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-muted">
        Showing <strong>{first}</strong>&ndash;<strong>{last}</strong> of <strong>{total}</strong>
      </p>

      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1)}
            rel="prev"
            className="flex min-h-11 items-center rounded-lg border border-[var(--line-strong)] px-3 font-medium hover:bg-[var(--surface-muted)]"
          >
            Previous
          </Link>
        ) : (
          <span className="flex min-h-11 items-center px-3 text-muted">Previous</span>
        )}

        <span className="px-1 text-muted">
          Page {page} of {totalPages}
        </span>

        {page < totalPages ? (
          <Link
            href={buildHref(page + 1)}
            rel="next"
            className="flex min-h-11 items-center rounded-lg border border-[var(--line-strong)] px-3 font-medium hover:bg-[var(--surface-muted)]"
          >
            Next
          </Link>
        ) : (
          <span className="flex min-h-11 items-center px-3 text-muted">Next</span>
        )}
      </div>
    </nav>
  );
}
