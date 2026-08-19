import type { Metadata } from 'next';
import Link from 'next/link';
import { requireOversight } from '@/lib/auth/authorize';
import {
  defaultRange,
  getDashboardMetrics,
  getOperationalAlerts,
  type DashboardRange,
} from '@/lib/domain/analytics';
import { parseIsoDayString, formatDate, formatDuration } from '@/lib/time';
import { Alert, Card, CardHeader, PageHeading } from '@/components/ui/surface';
import { CategoryBars, PeakHoursChart, VisitsByDayChart } from './charts';
import { RangePicker } from './range-picker';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/** Only well-formed dates are honoured; anything else falls back to the default. */
function resolveRange(params: { from?: string; to?: string }): DashboardRange {
  const fallback = defaultRange();
  const from = params.from && parseIsoDayString(params.from) ? params.from : fallback.from;
  const to = params.to && parseIsoDayString(params.to) ? params.to : fallback.to;
  return from <= to ? { from, to } : fallback;
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireOversight();
  const params = await searchParams;
  const range = resolveRange(params);

  const [metrics, alerts] = await Promise.all([
    getDashboardMetrics(range),
    getOperationalAlerts(),
  ]);

  return (
    <>
      <PageHeading
        title="Dashboard"
        description="Live figures calculated from stored visit records."
      />

      {alerts.length > 0 ? (
        <div className="mb-5 flex flex-col gap-3">
          {alerts.map((alert) => (
            <Alert
              key={alert.id}
              tone={alert.severity === 'danger' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'info'}
              title={alert.title}
            >
              {alert.detail}
              {alert.href ? (
                <>
                  {' '}
                  <Link href={alert.href} className="font-medium underline underline-offset-2">
                    Open
                  </Link>
                </>
              ) : null}
            </Alert>
          ))}
        </div>
      ) : null}

      <section aria-labelledby="today-heading" className="mb-6">
        <h2 id="today-heading" className="mb-3 text-sm font-semibold tracking-wide uppercase text-muted">
          Today
        </h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Expected" value={metrics.today.expected} />
          <Stat label="On site" value={metrics.today.checkedIn} tone="success" />
          <Stat label="Checked out" value={metrics.today.checkedOut} />
          <Stat label="Overdue" value={metrics.today.overdue} tone={metrics.today.overdue > 0 ? 'danger' : undefined} />
          <Stat label="Pending approval" value={metrics.today.pending} tone={metrics.today.pending > 0 ? 'warning' : undefined} />
          <Stat label="Denied" value={metrics.today.denied} />
        </div>
      </section>

      <section aria-labelledby="range-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="range-heading" className="text-sm font-semibold tracking-wide uppercase text-muted">
            Selected range
          </h2>
          <RangePicker from={range.from} to={range.to} />
        </div>

        <p className="mb-4 text-sm text-muted">
          {formatDate(new Date(`${range.from}T00:00:00Z`))} to{' '}
          {formatDate(new Date(`${range.to}T00:00:00Z`))}
        </p>

        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Appointments" value={metrics.totals.appointments} />
          <Stat
            label="Approval rate"
            value={metrics.totals.approvalRatePercent === null ? '-' : `${metrics.totals.approvalRatePercent}%`}
            hint={`${metrics.totals.approvals} approved, ${metrics.totals.rejections} rejected`}
          />
          <Stat
            label="No-show rate"
            value={metrics.totals.noShowRatePercent === null ? '-' : `${metrics.totals.noShowRatePercent}%`}
            hint={`${metrics.totals.noShows} no-show`}
          />
          <Stat
            label="Average visit"
            value={
              metrics.totals.averageDurationMinutes === null
                ? '-'
                : formatDuration(metrics.totals.averageDurationMinutes)
            }
            hint={`${metrics.totals.completedVisits} completed visits`}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Check-ins by day" description="Malaysian calendar days." />
            <div className="p-2">
              <VisitsByDayChart data={metrics.visitsByDay} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Busiest arrival hours" description="When visitors actually arrive." />
            <div className="p-2">
              <PeakHoursChart data={metrics.peakHours} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Visit types" />
            <CategoryBars data={metrics.visitTypeDistribution} />
          </Card>

          <Card>
            <CardHeader title="Top destinations" />
            <CategoryBars data={metrics.topDestinations} />
          </Card>
        </div>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'success' | 'warning' | 'danger';
}) {
  const color =
    tone === 'success'
      ? 'var(--ok)'
      : tone === 'warning'
        ? 'var(--warn)'
        : tone === 'danger'
          ? 'var(--danger)'
          : 'var(--text-strong)';

  return (
    <div className="surface-card rounded-xl px-4 py-3">
      <p className="text-xs tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
