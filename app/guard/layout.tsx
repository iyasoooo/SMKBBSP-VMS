import { requireGuardOrAdmin } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { StaffShell } from '@/components/staff-shell';
/**
 * Rendered per request. These read school settings and the session from the
 * database, so prerendering them would both bake in values an administrator
 * can change and make the build require a live database - which it should not.
 */
export const dynamic = 'force-dynamic';


export default async function GuardLayout({ children }: { children: React.ReactNode }) {
  // Admins retain oversight access to the gate screens; teachers do not.
  const user = await requireGuardOrAdmin('/guard');
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  const t = getDictionary(locale);

  return (
    <StaffShell
      user={user}
      roleLabel={t.today}
      schoolShortName={settings.schoolShortName}
      locale={locale}
      notificationsLabel={t.notifications}
      showLocaleToggle
      nav={[
        { href: '/guard', label: t.today },
        { href: '/guard/scan', label: t.scan },
        { href: '/guard/walk-in', label: t.walkIn },
        { href: '/guard/active', label: t.onSite },
        { href: '/guard/reports', label: t.history },
        { href: '/guard/emergency', label: t.emergency },
        { href: '/map', label: t.schoolMap },
      ]}
    >
      {children}
    </StaffShell>
  );
}
