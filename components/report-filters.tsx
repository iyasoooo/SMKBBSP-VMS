'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, buttonClasses } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import type { ReportFilters } from '@/lib/reports/query';

export interface FilterOptions {
  teachers: Array<{ id: string; name: string }>;
  destinations: Array<{ id: string; nameEn: string }>;
  visitTypes: Array<{ id: string; nameEn: string }>;
}

/**
 * Report filter bar, shared by the administrator and guard report screens.
 *
 * Filters live in the query string, which is what lets the export links carry
 * exactly the same filters the table is showing - the download URL is built
 * from the current parameters rather than from a parallel piece of state.
 * Navigation uses the current pathname, so the same bar drives either screen.
 */
export function ReportFilterBar({
  filters,
  options,
  canExport = false,
}: {
  filters: ReportFilters;
  options: FilterOptions;
  /**
   * Whether to offer the downloads. Off for guards: the gate terminal is a
   * shared device that is often left signed in, and a one-click download of
   * every visit the school has ever recorded does not belong on it. This only
   * removes the buttons - the export route enforces the same rule itself,
   * since a link is not access control.
   */
  canExport?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [draft, setDraft] = useState(filters);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    params.set('from', draft.from);
    params.set('to', draft.to);
    if (draft.status && draft.status !== 'ALL') params.set('status', draft.status);
    if (draft.teacherId) params.set('teacherId', draft.teacherId);
    if (draft.destinationId) params.set('destinationId', draft.destinationId);
    if (draft.visitTypeId) params.set('visitTypeId', draft.visitTypeId);
    if (draft.source && draft.source !== 'ALL') params.set('source', draft.source);
    if (draft.category && draft.category !== 'ALL') params.set('category', draft.category);
    router.push(`${pathname}?${params.toString()}`);
  }

  const exportQuery = searchParams.toString();

  return (
    <form onSubmit={apply} className="surface-card mb-5 rounded-xl p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Labeled label="From" id="f-from">
          <Input
            id="f-from"
            type="date"
            value={draft.from}
            max={draft.to}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Labeled>

        <Labeled label="To" id="f-to">
          <Input
            id="f-to"
            type="date"
            value={draft.to}
            min={draft.from}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Labeled>

        <Labeled label="Status" id="f-status">
          <Select
            id="f-status"
            value={draft.status ?? 'ALL'}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as ReportFilters['status'] })}
          >
            <option value="ALL">All statuses</option>
            <option value="EXPECTED">Expected</option>
            <option value="CHECKED_IN">On site</option>
            <option value="CHECKED_OUT">Completed</option>
            <option value="NO_SHOW">No show</option>
            <option value="DENIED">Denied</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </Labeled>

        <Labeled label="Source" id="f-source">
          <Select
            id="f-source"
            value={draft.source ?? 'ALL'}
            onChange={(e) => setDraft({ ...draft, source: e.target.value as ReportFilters['source'] })}
          >
            <option value="ALL">All sources</option>
            <option value="ONLINE">Online</option>
            <option value="WALK_IN">Walk-in</option>
          </Select>
        </Labeled>

        <Labeled label="Host teacher" id="f-teacher">
          <Select
            id="f-teacher"
            value={draft.teacherId ?? ''}
            onChange={(e) => setDraft({ ...draft, teacherId: e.target.value || undefined })}
          >
            <option value="">All teachers</option>
            {options.teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </option>
            ))}
          </Select>
        </Labeled>

        <Labeled label="Destination" id="f-destination">
          <Select
            id="f-destination"
            value={draft.destinationId ?? ''}
            onChange={(e) => setDraft({ ...draft, destinationId: e.target.value || undefined })}
          >
            <option value="">All destinations</option>
            {options.destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.nameEn}
              </option>
            ))}
          </Select>
        </Labeled>

        <Labeled label="Visit type" id="f-type">
          <Select
            id="f-type"
            value={draft.visitTypeId ?? ''}
            onChange={(e) => setDraft({ ...draft, visitTypeId: e.target.value || undefined })}
          >
            <option value="">All types</option>
            {options.visitTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.nameEn}
              </option>
            ))}
          </Select>
        </Labeled>

        <Labeled label="Visitor category" id="f-category">
          <Select
            id="f-category"
            value={draft.category ?? 'ALL'}
            onChange={(e) =>
              setDraft({ ...draft, category: e.target.value as ReportFilters['category'] })
            }
          >
            <option value="ALL">All categories</option>
            <option value="PARENT">Parent</option>
            <option value="GUARDIAN">Guardian</option>
            <option value="OFFICIAL">Official</option>
            <option value="CONTRACTOR">Contractor</option>
            <option value="VENDOR">Vendor</option>
            <option value="ALUMNI">Alumni</option>
            <option value="OTHER">Other</option>
          </Select>
        </Labeled>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line-soft)] pt-4">
        <Button type="submit">Apply filters</Button>
        <Button type="button" variant="ghost" onClick={() => router.push(pathname)}>
          Reset
        </Button>

        {canExport ? (
          <span className="ml-auto flex gap-2">
            <a
              href={`/admin/reports/export?format=xlsx&${exportQuery}`}
              className={buttonClasses('secondary', 'md')}
            >
              Export Excel
            </a>
            <a
              href={`/admin/reports/export?format=pdf&${exportQuery}`}
              className={buttonClasses('secondary', 'md')}
            >
              Export PDF
            </a>
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Labeled({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
