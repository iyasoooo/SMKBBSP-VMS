import { PublicShell } from '@/components/public-shell';

/**
 * Rendered per request. The shell reads school settings and the theme from the
 * database, so prerendering would both bake in values an administrator can
 * change and make the build require a live database - which it should not.
 */
export const dynamic = 'force-dynamic';

/** Shell for the public, account-free visitor journey. */
export default function VisitLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
