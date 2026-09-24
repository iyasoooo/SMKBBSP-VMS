import type { Metadata } from 'next';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/authorize';
import { resetPasswordAction, setUserActiveAction, updateUserAction } from '@/app/admin/actions';
import { formatDateTime } from '@/lib/time';
import { Alert, Card, PageHeading, Pill, TableScroll } from '@/components/ui/surface';
import { ActionForm } from '@/components/action-form';
import { Input } from '@/components/ui/field';
import { CreateUserForm } from './create-form';

export const metadata: Metadata = { title: 'Staff accounts' };
export const dynamic = 'force-dynamic';

const ROLE_TONE = {
  ADMIN: 'danger',
  GUARD: 'info',
  TEACHER: 'success',
  PRINCIPAL: 'warning',
} as const;

export default async function UsersPage() {
  const currentUser = await requireAdmin('/admin/users');

  const [users, activeAdminCount] = await Promise.all([
    prisma.user.findMany({
      include: {
        teacherProfile: { select: { department: true, staffCode: true, isAcceptingVisits: true } },
        _count: { select: { sessions: { where: { revokedAt: null } } } },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    }),
    prisma.user.count({ where: { role: Role.ADMIN, isActive: true } }),
  ]);

  return (
    <>
      <PageHeading
        title="Staff accounts"
        description="Deactivating an account or resetting its password ends all of its active sessions immediately."
      />

      {activeAdminCount === 1 ? (
        <div className="mb-5">
          <Alert tone="warning" title="Only one active administrator">
            The last active administrator cannot be deactivated, because doing so would lock
            everyone out of user management. Create a second administrator before making changes.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <div className="border-b border-[var(--line-soft)] px-5 py-4">
            <h2 className="text-base font-semibold">Accounts</h2>
          </div>

          <TableScroll>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Staff accounts</caption>
              <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Name</th>
                  <th scope="col" className="px-4 py-3 font-medium">Role</th>
                  <th scope="col" className="px-4 py-3 font-medium">Last login</th>
                  <th scope="col" className="px-4 py-3 font-medium">Sessions</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line-soft)]">
                {users.map((user) => {
                  const isSelf = user.id === currentUser.id;
                  const isLastAdmin =
                    user.role === Role.ADMIN && user.isActive && activeAdminCount === 1;

                  return (
                    <tr key={user.id} className="align-top">
                      <td className="px-4 py-3">
                        <span className="block font-medium text-[var(--text-strong)]">
                          {user.name}
                          {isSelf ? <span className="ml-1 text-xs text-muted">(you)</span> : null}
                        </span>
                        <span className="block text-xs text-muted">{user.email}</span>
                        {user.teacherProfile ? (
                          <span className="block text-xs text-muted">
                            {user.teacherProfile.staffCode} &middot;{' '}
                            {user.teacherProfile.department}
                            {user.teacherProfile.isAcceptingVisits ? '' : ' · not accepting visits'}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={ROLE_TONE[user.role]}>{user.role}</Pill>
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        {user._count.sessions}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={user.isActive ? 'success' : 'neutral'}>
                          {user.isActive ? 'Active' : 'Disabled'}
                        </Pill>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-3">
                          {/*
                            Collapsed by default. Correcting a name is rare next
                            to deactivating or resetting a password, and three
                            inputs open on every row would bury the two actions
                            somebody actually came here for.
                          */}
                          <details className="text-sm">
                            <summary className="cursor-pointer text-xs text-muted underline-offset-2 hover:underline">
                              Edit details
                            </summary>

                            <ActionForm
                              action={updateUserAction}
                              hidden={{
                                userId: user.id,
                                // Marks the profile fields as present, so the
                                // action can tell "left blank" from "not sent".
                                ...(user.teacherProfile ? { hasProfile: '1' } : {}),
                              }}
                              submitLabel="Save changes"
                              variant="secondary"
                              successMessage="Saved."
                              className="mt-2 flex flex-col gap-2"
                            >
                              <Input
                                name="name"
                                defaultValue={user.name}
                                minLength={2}
                                maxLength={120}
                                required
                                aria-label={`Name for ${user.name}`}
                              />

                              {/*
                                The address someone signs in with. Changing it
                                ends their sessions, because the usual reason to
                                change one is that the account now belongs to
                                somebody else.
                              */}
                              <Input
                                name="email"
                                type="email"
                                defaultValue={user.email}
                                maxLength={254}
                                required
                                autoCapitalize="none"
                                spellCheck={false}
                                aria-label={`Email for ${user.name}`}
                              />

                              {user.teacherProfile ? (
                                <>
                                  <Input
                                    name="department"
                                    defaultValue={user.teacherProfile.department}
                                    maxLength={80}
                                    placeholder="Department"
                                    aria-label={`Department for ${user.name}`}
                                  />
                                  {/*
                                    Unticking removes them from the public
                                    request form without disabling the account -
                                    the difference between on leave and gone.
                                  */}
                                  <label className="flex min-h-[var(--spacing-touch)] cursor-pointer items-center gap-2 text-xs">
                                    <input
                                      type="checkbox"
                                      name="isAcceptingVisits"
                                      defaultChecked={user.teacherProfile.isAcceptingVisits}
                                      className="size-4 rounded border-[var(--line-strong)] accent-[var(--accent)]"
                                    />
                                    Accepting visitors
                                  </label>
                                </>
                              ) : null}
                            </ActionForm>
                          </details>

                          {user.isActive ? (
                            isLastAdmin ? (
                              <span className="text-xs text-muted">
                                Last active administrator
                              </span>
                            ) : (
                              <ActionForm
                                action={setUserActiveAction}
                                hidden={{ userId: user.id, isActive: 'false' }}
                                submitLabel="Deactivate"
                                variant="secondary"
                                confirm={`Deactivate ${user.name}? Their active sessions will end immediately.`}
                              />
                            )
                          ) : (
                            <ActionForm
                              action={setUserActiveAction}
                              hidden={{ userId: user.id, isActive: 'true' }}
                              submitLabel="Reactivate"
                              variant="secondary"
                              confirm={`Reactivate ${user.name}?`}
                            />
                          )}

                          <ActionForm
                            action={resetPasswordAction}
                            hidden={{ userId: user.id }}
                            submitLabel="Reset password"
                            variant="ghost"
                            confirm={`Reset the password for ${user.name}? All of their sessions will end.`}
                            successMessage="Password reset. Give the new password to the user directly."
                            className="flex flex-col gap-2"
                          >
                            <Input
                              name="newPassword"
                              type="text"
                              minLength={10}
                              maxLength={200}
                              required
                              placeholder="New password (min 10)"
                              aria-label={`New password for ${user.name}`}
                              className="h-9 text-xs"
                            />
                          </ActionForm>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold">Create an account</h2>
          <CreateUserForm />
        </Card>
      </div>
    </>
  );
}
