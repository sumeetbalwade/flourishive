import type { ReactNode } from 'react';
import {
  Bar,
  BarChart as RBar,
  CartesianGrid,
  Line,
  LineChart as RLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** Chart styling: series use --chart-1..5, thin dashed grid, rounded bars, no axis lines. */
export const chartColors = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

const axis = {
  stroke: 'var(--text-faint)',
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;

function ChartTooltip() {
  return (
    <Tooltip
      cursor={{ fill: 'var(--accent-lo)' }}
      contentStyle={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        color: 'var(--text)',
        fontSize: 12,
      }}
    />
  );
}

export function BarChart({
  data,
  x,
  series,
  height = 240,
}: {
  data: object[];
  x: string;
  series: string[];
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RBar data={data}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
          <XAxis dataKey={x} {...axis} />
          <YAxis {...axis} width={32} />
          <ChartTooltip />
          {series.map((s, i) => (
            <Bar
              key={s}
              dataKey={s}
              fill={chartColors[i % 5]}
              radius={[8, 8, 0, 0]}
              maxBarSize={28}
            />
          ))}
        </RBar>
      </ResponsiveContainer>
    </div>
  );
}

export function LineChart({
  data,
  x,
  series,
  height = 240,
}: {
  data: object[];
  x: string;
  series: string[];
  height?: number;
}): ReactNode {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RLine data={data}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
          <XAxis dataKey={x} {...axis} />
          <YAxis {...axis} width={32} />
          <ChartTooltip />
          {series.map((s, i) => (
            <Line
              key={s}
              dataKey={s}
              stroke={chartColors[i % 5]}
              strokeWidth={2.5}
              dot={false}
              type="monotone"
            />
          ))}
        </RLine>
      </ResponsiveContainer>
    </div>
  );
}
