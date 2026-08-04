import { requireAdmin } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { StaffShell } from '@/components/staff-shell';
/**
 * Rendered per request. These read school settings and the session from the
 * database, so prerendering them would both bake in values an administrator
 * can change and make the build require a live database - which it should not.
 */
export const dynamic = 'force-dynamic';


export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin('/admin');
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);

  return (
    <StaffShell
      user={user}
      roleLabel="Administrator"
      schoolShortName={settings.schoolShortName}
      locale={locale}
      wide
      nav={[
        { href: '/admin', label: 'Dashboard' },
        { href: '/admin/appointments', label: 'Appointments' },
        { href: '/admin/visits', label: 'Visits' },
        { href: '/admin/reports', label: 'Reports' },
        { href: '/admin/blacklist', label: 'Blacklist' },
        { href: '/admin/users', label: 'Users' },
        { href: '/admin/destinations', label: 'Destinations' },
        { href: '/admin/notifications', label: 'Email' },
        { href: '/admin/audit', label: 'Audit log' },
        { href: '/admin/settings', label: 'Settings' },
      ]}
    >
      {children}
    </StaffShell>
  );
}
