"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = {
  stroke: "#82938a",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const GRID = "#edf1ef";

function money(cents: number) {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(0)}K`;
  return `$${d.toFixed(0)}`;
}

function moneyExact(cents: unknown) {
  return (Number(cents ?? 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

const tooltipStyle = {
  contentStyle: {
    borderRadius: 10,
    border: "1px solid #dce4df",
    boxShadow: "0 12px 32px -16px rgba(18,22,31,0.35)",
    fontSize: 12,
    padding: "8px 10px",
  },
  labelStyle: { color: "#405649", fontWeight: 600, marginBottom: 2 },
} as const;

export function SpendTrendChart({
  data,
}: {
  data: { month: string; planPaidCents: number; memberPaidCents: number; rebateCents: number }[];
}) {
  const shaped = data.map((d) => ({
    month: d.month.slice(5),
    Plan: d.planPaidCents,
    Member: d.memberPaidCents,
    Rebates: -d.rebateCents,
  }));
  return (
    <ResponsiveContainer width="100%" height={230}>
      <AreaChart data={shaped} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="planGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4e8c69" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#4e8c69" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={money} width={52} />
        <Tooltip {...tooltipStyle} formatter={(v) => moneyExact(Math.abs(Number(v ?? 0)))} />
        <Area
          type="monotone"
          dataKey="Plan"
          stroke="#397653"
          strokeWidth={2}
          fill="url(#planGrad)"
        />
        <Area
          type="monotone"
          dataKey="Member"
          stroke="#82938a"
          strokeWidth={1.5}
          fill="none"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Daily script volume, paid stacked over rejected.
 *
 * The rejected band is not noise to be hidden: a rejection is the plan
 * enforcing a rule, and its size relative to the paid band is one of the more
 * honest health indicators a sponsor can look at day to day.
 */
export function DailyVolumeChart({
  data,
}: {
  data: { date: string; paid: number; rejected: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
        <YAxis {...AXIS} width={44} tickFormatter={(v) => Number(v).toLocaleString()} />
        <Tooltip
          {...tooltipStyle}
          formatter={(v, name) => [Number(v ?? 0).toLocaleString(), name]}
        />
        <Bar dataKey="paid" name="Paid" stackId="a" fill="#4e8c69" radius={[0, 0, 0, 0]} />
        <Bar dataKey="rejected" name="Rejected" stackId="a" fill="#e6a3a3" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Net plan cost per member per month, month by month.
 *
 * The axis is not anchored at zero. A plan year moves within a few dollars of
 * PMPM and a zero-based axis compresses that into a flat line, which is the
 * opposite of what a trend chart is for. The partial month at the right edge is
 * drawn open rather than filled, because it is not yet comparable to the
 * others.
 */
export function PmpmTrendChart({
  data,
}: {
  data: { month: string; netPmpmCents: number; complete: boolean }[];
}) {
  const values = data.map((d) => d.netPmpmCents);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.25 || hi * 0.05;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...AXIS} tickFormatter={(m: string) => m.slice(5)} />
        <YAxis
          {...AXIS}
          width={52}
          domain={[lo - pad, hi + pad]}
          tickFormatter={(v) => `$${(Number(v) / 100).toFixed(0)}`}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(v) => [moneyExact(v), "Net plan cost PMPM"]}
        />
        <Line
          type="monotone"
          dataKey="netPmpmCents"
          name="Net plan cost PMPM"
          stroke="#0f766e"
          strokeWidth={2.25}
          /*
           * The points are drawn by a custom renderer, which paints them all at
           * once while the stroke animates in behind them. For the second or so
           * that takes, the chart reads as a short line followed by a scatter of
           * loose dots. Eight points do not need an entrance.
           */
          isAnimationActive={false}
          dot={(props) => {
            const { cx, cy, index } = props as {
              cx: number;
              cy: number;
              index: number;
            };
            const complete = data[index]?.complete ?? true;
            return (
              <circle
                key={index}
                cx={cx}
                cy={cy}
                r={3}
                fill={complete ? "#0f766e" : "#ffffff"}
                stroke="#0f766e"
                strokeWidth={1.5}
              />
            );
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ChannelBarChart({
  data,
}: {
  data: { channel: string; billedCents: number; claims: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
      >
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" {...AXIS} tickFormatter={money} />
        <YAxis
          type="category"
          dataKey="channel"
          {...AXIS}
          width={72}
          fontSize={12}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(v) => moneyExact(v)}
          cursor={{ fill: "#f6f8f7" }}
        />
        <Bar dataKey="billedCents" name="Plan cost" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.channel === "Specialty" ? "#7c3aed" : "#4e8c69"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Plan cost under both contracts as the AWP file moves.
 *
 * The finding is not either line, it is the distance between them: that is the
 * exposure the pass-through contract removes. Two lines leave the reader to
 * measure it, so the band between them is filled and the difference is what the
 * chart actually draws.
 */
export function SensitivityChart({
  data,
}: {
  data: { label: string; passThroughCents: number; traditionalCents: number }[];
}) {
  /*
   * The band is one range-valued series rather than a transparent floor with a
   * visible series stacked on it. A stack is anchored at zero, and that anchor
   * counts as data when the axis is fitted, which flattens both curves into the
   * top of the plot. The question here is how fast each contract moves, not
   * what either costs, so the axis is held to the range the curves occupy.
   */
  const shaped = data.map((d) => ({
    ...d,
    band: [
      Math.min(d.passThroughCents, d.traditionalCents),
      Math.max(d.passThroughCents, d.traditionalCents),
    ] as [number, number],
  }));
  const values = shaped.flatMap((d) => [d.passThroughCents, d.traditionalCents]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.35 || hi * 0.05;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart
        data={shaped}
        margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
      >
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis
          {...AXIS}
          tickFormatter={money}
          width={56}
          domain={[lo - pad, hi + pad * 0.4]}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(v, name) =>
            // The band arrives as the pair it is drawn between; the number
            // worth reading off it is the distance.
            Array.isArray(v)
              ? [moneyExact(Number(v[1]) - Number(v[0])), name]
              : [moneyExact(v), name]
          }
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Area
          dataKey="band"
          name="Exposure removed"
          stroke="none"
          fill="#b45309"
          fillOpacity={0.1}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="passThroughCents"
          name="Pass-through (Wisconsin)"
          stroke="#0f766e"
          strokeWidth={2.25}
          dot={{ r: 2.5 }}
        />
        <Line
          type="monotone"
          dataKey="traditionalCents"
          name="Traditional spread (Michigan)"
          stroke="#b45309"
          strokeWidth={2.25}
          strokeDasharray="5 3"
          dot={{ r: 2.5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function OopCurveChart({
  data,
  rxLimitCents,
}: {
  data: { date: string; rxOopCents: number; federalOopCents: number }[];
  rxLimitCents: number;
}) {
  const shaped = data.map((d) => ({
    date: d.date.slice(5),
    "Counts toward the $600 limit": d.rxOopCents,
    "Total out of pocket": d.federalOopCents,
    limit: rxLimitCents,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={shaped} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" {...AXIS} minTickGap={24} />
        <YAxis {...AXIS} tickFormatter={money} width={52} />
        <Tooltip {...tooltipStyle} formatter={(v) => moneyExact(v)} />
        <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 6 }} />
        <Line
          type="stepAfter"
          dataKey="Total out of pocket"
          stroke="#82938a"
          strokeWidth={1.75}
          dot={false}
        />
        <Line
          type="stepAfter"
          dataKey="Counts toward the $600 limit"
          stroke="#0f766e"
          strokeWidth={2.25}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="limit"
          name="$600 prescription limit"
          stroke="#b45309"
          strokeWidth={1.25}
          strokeDasharray="4 4"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

const WATERFALL_FILL = {
  total: "#24392e",
  in: "#0f766e",
  out: "#b45309",
} as const;

/**
 * A waterfall whose deduction is a rounding error next to its inflow.
 *
 * The rebate administration fee is about 1.6% of gross rebates, so drawn to
 * scale it is a two-pixel sliver floating at the top of the plot and the chart
 * reads as two unrelated columns. Two things fix that without misstating the
 * proportion, which is itself the finding: a floor on the drawn height so the
 * step is visible, and the amount printed on every bar so the eye never has to
 * measure the tiny one.
 */
export function WaterfallChart({
  data,
}: {
  data: { label: string; value: number; base: number; kind: "in" | "out" | "total" }[];
}) {
  const peak = Math.max(...data.map((d) => d.base + d.value), 0);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 24, right: 12, left: 4, bottom: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} interval={0} height={28} />
        <YAxis
          {...AXIS}
          tickFormatter={money}
          width={56}
          domain={[0, peak * 1.12]}
        />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: "#f6f8f7" }}
          formatter={(v, name) => (name === "value" ? moneyExact(v) : null)}
        />
        <Bar dataKey="base" stackId="w" fill="transparent" />
        <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]} minPointSize={4}>
          <LabelList
            dataKey="value"
            position="top"
            formatter={(v: unknown) => money(Number(v ?? 0))}
            style={{ fontSize: 11, fontWeight: 600, fill: "#405649" }}
          />
          {data.map((d, i) => (
            <Cell key={i} fill={WATERFALL_FILL[d.kind]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
