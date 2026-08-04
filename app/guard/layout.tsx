import { requireGuardOrAdmin } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { getDictionary } from '@/lib/i18n/dictionary';
import { StaffShell } from '@/components/staff-shell';

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
      showLocaleToggle
      nav={[
        { href: '/guard', label: t.today },
        { href: '/guard/scan', label: t.scan },
        { href: '/guard/walk-in', label: t.walkIn },
        { href: '/guard/active', label: t.onSite },
        { href: '/guard/emergency', label: t.emergency },
      ]}
    >
      {children}
    </StaffShell>
  );
}
