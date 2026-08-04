import type { Metadata } from 'next';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/authorize';
import { toggleDestinationAction, toggleVisitTypeAction } from '@/app/admin/actions';
import { Card, PageHeading, Pill, TableScroll } from '@/components/ui/surface';
import { ActionForm } from '@/components/action-form';
import { DestinationCreateForm } from './create-form';

export const metadata: Metadata = { title: 'Destinations and visit types' };
export const dynamic = 'force-dynamic';

export default async function DestinationsPage() {
  await requireAdmin('/admin/destinations');

  const [destinations, visitTypes] = await Promise.all([
    prisma.destination.findMany({
      include: { _count: { select: { visits: true } } },
      orderBy: [{ isActive: 'desc' }, { nameEn: 'asc' }],
    }),
    prisma.visitType.findMany({
      include: { _count: { select: { appointments: true } } },
      orderBy: [{ isActive: 'desc' }, { nameEn: 'asc' }],
    }),
  ]);

  return (
    <>
      <PageHeading
        title="Destinations and visit types"
        description="Deactivating an entry hides it from new requests. Existing records keep their history."
      />

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <div className="border-b border-[var(--line-soft)] px-5 py-4">
              <h2 className="text-base font-semibold">Destinations</h2>
            </div>
            <TableScroll>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Destinations</caption>
                <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Name</th>
                    <th scope="col" className="px-4 py-3 font-medium">Code</th>
                    <th scope="col" className="px-4 py-3 font-medium">Visits</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line-soft)]">
                  {destinations.map((destination) => (
                    <tr key={destination.id} className="align-top">
                      <td className="px-4 py-3">
                        <span className="block font-medium text-[var(--text-strong)]">
                          {destination.nameEn}
                        </span>
                        <span className="block text-xs text-muted">{destination.nameMs}</span>
                        {destination.instructionsEn ? (
                          <span className="mt-1 block max-w-sm text-xs text-muted">
                            {destination.instructionsEn}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{destination.code}</td>
                      <td className="px-4 py-3 tabular-nums">{destination._count.visits}</td>
                      <td className="px-4 py-3">
                        <Pill tone={destination.isActive ? 'success' : 'neutral'}>
                          {destination.isActive ? 'Active' : 'Hidden'}
                        </Pill>
                      </td>
                      <td className="px-4 py-3">
                        <ActionForm
                          action={toggleDestinationAction}
                          hidden={{
                            id: destination.id,
                            isActive: destination.isActive ? 'false' : 'true',
                          }}
                          submitLabel={destination.isActive ? 'Hide' : 'Show'}
                          variant="secondary"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Card>

          <Card>
            <div className="border-b border-[var(--line-soft)] px-5 py-4">
              <h2 className="text-base font-semibold">Visit types</h2>
              <p className="mt-0.5 text-sm text-muted">
                &ldquo;ID required&rdquo; forces the guard to declare that physical identification
                was sighted before check-in.
              </p>
            </div>
            <TableScroll>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Visit types</caption>
                <thead className="border-b border-[var(--line-soft)] text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Name</th>
                    <th scope="col" className="px-4 py-3 font-medium">Duration</th>
                    <th scope="col" className="px-4 py-3 font-medium">ID required</th>
                    <th scope="col" className="px-4 py-3 font-medium">Used</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line-soft)]">
                  {visitTypes.map((type) => (
                    <tr key={type.id}>
                      <td className="px-4 py-3">
                        <span className="block font-medium text-[var(--text-strong)]">
                          {type.nameEn}
                        </span>
                        <span className="block text-xs text-muted">{type.nameMs}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {type.defaultDurationMinutes} min
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={type.requiresIdSighted ? 'warning' : 'neutral'}>
                          {type.requiresIdSighted ? 'Yes' : 'No'}
                        </Pill>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{type._count.appointments}</td>
                      <td className="px-4 py-3">
                        <Pill tone={type.isActive ? 'success' : 'neutral'}>
                          {type.isActive ? 'Active' : 'Hidden'}
                        </Pill>
                      </td>
                      <td className="px-4 py-3">
                        <ActionForm
                          action={toggleVisitTypeAction}
                          hidden={{ id: type.id, isActive: type.isActive ? 'false' : 'true' }}
                          submitLabel={type.isActive ? 'Hide' : 'Show'}
                          variant="secondary"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="text-base font-semibold">Add a destination</h2>
          <DestinationCreateForm />
        </Card>
      </div>
    </>
  );
}
