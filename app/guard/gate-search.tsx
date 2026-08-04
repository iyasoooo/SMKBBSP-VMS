'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';

/**
 * Gate search box.
 *
 * A plain GET-style submit that pushes `?q=` rather than a live-filtering
 * input: on a tablet over mobile data, a request per keystroke is slower and
 * less predictable than one deliberate search.
 */
export function GateSearch({
  defaultValue,
  label,
  placeholder,
}: {
  defaultValue: string;
  label: string;
  placeholder: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim().length >= 2) params.set('q', value.trim());
    else params.delete('q');
    router.push(`/guard?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap gap-2" role="search">
      <label htmlFor="gate-search" className="sr-only">
        {label}
      </label>
      <Input
        id="gate-search"
        name="q"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="h-12 min-w-0 flex-1 text-base"
        autoComplete="off"
      />
      <Button type="submit" size="lg">
        {label}
      </Button>
      {defaultValue ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={() => {
            setValue('');
            router.push('/guard');
          }}
        >
          Clear
        </Button>
      ) : null}
    </form>
  );
}
