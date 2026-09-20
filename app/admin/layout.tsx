import { Role } from '@prisma/client';
import { canAdminister, requireOversight } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { StaffShell } from '@/components/staff-shell';

/**
 * Rendered per request. These read school settings and the session from the
 * database, so prerendering them would both bake in values an administrator
 * can change and make the build require a live database - which it should not.
 */
export const dynamic = 'force-dynamic';

/**
 * The administrative area, shared by two roles with very different powers.
 *
 * An administrator runs the system. A principal only reads it: the same
 * dashboards, history, reports and audit trail, with nothing they can change.
 * The screens that exist purely to edit configuration - users, destinations,
 * settings, mail retries - are absent from their navigation *and* refuse them
 * directly, because a navigation list is not a security boundary.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOversight('/admin');
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);

  const readOnly = [
    { href: '/admin', label: 'Dashboard' },
    { href: '/admin/appointments', label: 'Appointments' },
    { href: '/admin/visits', label: 'Visits' },
    { href: '/admin/reports', label: 'Reports' },
    { href: '/admin/blacklist', label: 'Blacklist' },
    { href: '/admin/audit', label: 'Audit log' },
  ];

  const administrative = [
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/destinations', label: 'Destinations' },
    { href: '/admin/settings', label: 'Settings' },
  ];

  return (
    <StaffShell
      user={user}
      roleLabel={user.role === Role.PRINCIPAL ? 'Principal (view only)' : 'Administrator'}
      schoolShortName={settings.schoolShortName}
      locale={locale}
      wide
      nav={canAdminister(user.role) ? [...readOnly, ...administrative] : readOnly}
    >
      {children}
    </StaffShell>
  );
}
