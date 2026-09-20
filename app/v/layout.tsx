import { PublicShell } from '@/components/public-shell';

/**
 * Rendered per request. The shell reads school settings and the theme from the
 * database, so prerendering would both bake in values an administrator can
 * change and make the build require a live database - which it should not.
 */
export const dynamic = 'force-dynamic';

/**
 * Shell for the private pass/status link.
 *
 * Separate from `/visit` only because the routes are separate; the visitor
 * moves straight from one to the other, so they must look like one site.
 */
export default function PassLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
