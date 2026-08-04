'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Dashboard charts.
 *
 * Every series is passed in from a server component that computed it with a
 * database query. These components hold no data of their own and invent
 * nothing: an empty array renders an explicit "no data" state rather than a
 * placeholder shape.
 *
 * One accent hue is used throughout with opacity for emphasis, rather than a
 * rainbow palette, so the charts stay readable in both themes and for
 * colour-blind viewers.
 */

const ACCENT = '#3f6db3';
const GRID = 'rgba(127,143,170,0.25)';

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-56 items-center justify-center text-sm text-muted">{message}</div>
  );
}

const tooltipStyle = {
  background: 'var(--surface-card)',
  border: '1px solid var(--line-strong)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--text-body)',
} as const;

export function VisitsByDayChart({ data }: { data: Array<{ day: string; count: number }> }) {
  if (data.length === 0) return <EmptyChart message="No visits in the selected range." />;

  // Long ranges would render an unreadable axis, so labels thin out as the
  // range grows rather than overlapping.
  const step = Math.max(1, Math.ceil(data.length / 10));
  const formatted = data.map((point) => ({
    ...point,
    label: point.day.slice(5), // MM-DD
  }));

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={formatted} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          interval={step - 1}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(127,143,170,0.12)' }} />
        <Bar dataKey="count" name="Check-ins" fill={ACCENT} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PeakHoursChart({ data }: { data: Array<{ hour: number; count: number }> }) {
  if (data.every((point) => point.count === 0)) {
    return <EmptyChart message="No arrivals recorded in the selected range." />;
  }

  const busiest = Math.max(...data.map((point) => point.count));
  const formatted = data.map((point) => ({
    ...point,
    label: `${String(point.hour).padStart(2, '0')}:00`,
  }));

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={formatted} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(127,143,170,0.12)' }} />
        <Bar dataKey="count" name="Arrivals" radius={[3, 3, 0, 0]}>
          {formatted.map((point) => (
            // The busiest hour is emphasised; the rest recede.
            <Cell
              key={point.hour}
              fill={ACCENT}
              fillOpacity={point.count === busiest && busiest > 0 ? 1 : 0.45}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryBars({ data }: { data: Array<{ label: string; count: number }> }) {
  if (data.length === 0) return <EmptyChart message="No data in the selected range." />;

  const max = Math.max(...data.map((row) => row.count), 1);

  // A plain proportional bar list beats a pie chart here: exact comparison is
  // easy, labels are always legible, and it needs no colour coding.
  return (
    <ul className="flex flex-col gap-3 px-5 py-4">
      {data.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-[var(--text-body)]">{row.label}</span>
            <span className="font-semibold tabular-nums text-[var(--text-strong)]">
              {row.count}
            </span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full"
            style={{ background: 'var(--surface-muted)' }}
            role="presentation"
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${(row.count / max) * 100}%`, background: ACCENT }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
