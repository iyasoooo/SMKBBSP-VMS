'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';

/**
 * Date-range control shared by the dashboard and reports.
 *
 * Writes `from`/`to` into the query string rather than component state, so a
 * chosen range survives a reload and can be shared or bookmarked. Other query
 * parameters (report filters) are preserved.
 */
export function RangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    params.set('from', start);
    params.set('to', end);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="range-from" className="text-xs font-medium text-muted">
          From
        </label>
        <Input
          id="range-from"
          type="date"
          value={start}
          max={end}
          onChange={(event) => setStart(event.target.value)}
          className="h-11 w-40"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="range-to" className="text-xs font-medium text-muted">
          To
        </label>
        <Input
          id="range-to"
          type="date"
          value={end}
          min={start}
          onChange={(event) => setEnd(event.target.value)}
          className="h-11 w-40"
        />
      </div>
      <Button type="submit">Apply</Button>
    </form>
  );
}
