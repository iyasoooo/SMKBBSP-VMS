import type { Metadata } from 'next';
import { SettingType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/authorize';
import { SETTING_DEFINITIONS, SETTING_KEYS, type SettingKey } from '@/lib/domain/settings';
import { updateSettingAction } from '@/app/admin/actions';
import { formatDateTime } from '@/lib/time';
import { Alert, Card, PageHeading } from '@/components/ui/surface';
import { ActionForm } from '@/components/action-form';
import { Input, Select } from '@/components/ui/field';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

const CATEGORY_LABELS: Record<string, string> = {
  school: 'School identity',
  hours: 'Visiting hours and booking',
  passes: 'Passes and badges',
  operations: 'Operations',
  privacy: 'Privacy and retention',
};

export default async function SettingsPage() {
  await requireAdmin('/admin/settings');

  const rows = await prisma.setting.findMany({ where: { key: { in: SETTING_KEYS } } });
  const stored = new Map(rows.map((row) => [row.key, row]));

  const grouped = new Map<string, SettingKey[]>();
  for (const key of SETTING_KEYS) {
    const category = SETTING_DEFINITIONS[key].category;
    grouped.set(category, [...(grouped.get(category) ?? []), key]);
  }

  return (
    <>
      <PageHeading
        title="Settings"
        description="Values the school can change without a code change. Every update is audited."
      />

      <div className="mb-5">
        <Alert tone="info">
          Changing visiting hours or grace periods affects new requests and newly issued passes.
          Passes that have already been issued keep the window they were created with.
        </Alert>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {[...grouped.entries()].map(([category, keys]) => (
          <Card key={category}>
            <div className="border-b border-[var(--line-soft)] px-5 py-4">
              <h2 className="text-base font-semibold">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
            </div>

            <ul className="divide-y divide-[var(--line-soft)]">
              {keys.map((key) => {
                const definition = SETTING_DEFINITIONS[key];
                const row = stored.get(key);
                const value = row?.value ?? definition.defaultValue;

                return (
                  <li key={key} className="px-5 py-4">
                    <label
                      htmlFor={`setting-${key}`}
                      className="block text-sm font-medium text-[var(--text-strong)]"
                    >
                      {definition.label}
                    </label>
                    <p className="mt-0.5 mb-2 text-xs text-muted">{definition.description}</p>

                    <ActionForm
                      action={updateSettingAction}
                      hidden={{ key }}
                      submitLabel="Save"
                      variant="secondary"
                      successMessage="Saved."
                      className="flex flex-wrap items-center gap-2"
                    >
                      {definition.type === SettingType.BOOL ? (
                        <Select
                          id={`setting-${key}`}
                          name="value"
                          defaultValue={value}
                          className="w-44"
                        >
                          <option value="true">Enabled</option>
                          <option value="false">Disabled</option>
                        </Select>
                      ) : (
                        <Input
                          id={`setting-${key}`}
                          name="value"
                          defaultValue={value}
                          type={
                            definition.type === SettingType.INT
                              ? 'number'
                              : definition.type === SettingType.TIME
                                ? 'time'
                                : 'text'
                          }
                          min={definition.type === SettingType.INT ? 0 : undefined}
                          className="w-44"
                        />
                      )}
                    </ActionForm>

                    <p className="mt-2 font-mono text-xs text-muted">
                      key: {key}
                      {row ? ` · updated ${formatDateTime(row.updatedAt)}` : ' · default'}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
