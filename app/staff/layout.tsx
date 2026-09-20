import { Role } from '@prisma/client';
import { requireRole } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { StaffShell, type NavItem } from '@/components/staff-shell';

/**
 * Rendered per request. These read school settings and the session from the
 * database, so prerendering them would both bake in values an administrator
 * can change and make the build require a live database - which it should not.
 */
export const dynamic = 'force-dynamic';

/**
 * Shell for screens shared by more than one staff role.
 *
 * The navigation is built from the signed-in role rather than shown to
 * everyone and filtered in the browser: a teacher must not be handed gate
 * links they cannot open, and hiding a link was never authorization anyway -
 * every destination re-checks the role for itself.
 */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole([Role.GUARD, Role.ADMIN, Role.TEACHER], '/staff/checkpoint');
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  const t = getDictionary(locale);

  const nav: NavItem[] =
    user.role === Role.TEACHER
      ? [
          { href: '/teacher', label: 'Overview' },
          { href: '/teacher/visits', label: 'My visits' },
          { href: '/staff/checkpoint', label: t.checkpoint },
        ]
      : [
          { href: '/guard', label: t.today },
          { href: '/guard/active', label: t.onSite },
          { href: '/staff/checkpoint', label: t.checkpoint },
        ];

  return (
    <StaffShell
      user={user}
      roleLabel={t.checkpoint}
      schoolShortName={settings.schoolShortName}
      locale={locale}
      showLocaleToggle
      nav={nav}
    >
      {children}
    </StaffShell>
  );
}
