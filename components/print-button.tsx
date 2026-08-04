'use client';

import { Button } from '@/components/ui/button';

/**
 * Print trigger.
 *
 * A client component purely because `window.print()` needs the browser. It
 * carries the `no-print` class so the button never appears on the printed
 * sheet it produces.
 */
export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button type="button" size="lg" className="no-print" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
