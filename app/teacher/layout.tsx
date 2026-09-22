import { requireTeacher } from '@/lib/auth/authorize';
import { getSettings } from '@/lib/domain/settings';
import { getLocale } from '@/lib/theme';
import { StaffShell } from '@/components/staff-shell';
/**
 * Rendered per request. These read school settings and the session from the
 * database, so prerendering them would both bake in values an administrator
 * can change and make the build require a live database - which it should not.
 */
export const dynamic = 'force-dynamic';


export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  // Authorization happens here and is re-checked by every page and action.
  const user = await requireTeacher('/teacher');
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);

  return (
    <StaffShell
      user={user}
      roleLabel="Staff"
      schoolShortName={settings.schoolShortName}
      locale={locale}
      nav={[
        { href: '/teacher', label: 'Overview' },
        { href: '/teacher/requests', label: 'Requests' },
        { href: '/teacher/visits', label: 'My visits' },
      ]}
    >
      {children}
    </StaffShell>
  );
}
