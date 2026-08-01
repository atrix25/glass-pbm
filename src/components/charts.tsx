"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = {
  stroke: "#8493ab",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const GRID = "#eceef2";

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
    border: "1px solid #d5dae3",
    boxShadow: "0 12px 32px -16px rgba(18,22,31,0.35)",
    fontSize: 12,
    padding: "8px 10px",
  },
  labelStyle: { color: "#404b60", fontWeight: 600, marginBottom: 2 },
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
            <stop offset="0%" stopColor="#1ca2a7" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#1ca2a7" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={money} width={52} />
        <Tooltip {...tooltipStyle} formatter={(v) => moneyExact(Math.abs(Number(v ?? 0)))} />
        <Area
          type="monotone"
          dataKey="Plan"
          stroke="#148187"
          strokeWidth={2}
          fill="url(#planGrad)"
        />
        <Area
          type="monotone"
          dataKey="Member"
          stroke="#8493ab"
          strokeWidth={1.5}
          fill="none"
        />
      </AreaChart>
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
          cursor={{ fill: "#f6f7f9" }}
        />
        <Bar dataKey="billedCents" name="Plan cost" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.channel === "Specialty" ? "#7c3aed" : "#1ca2a7"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SensitivityChart({
  data,
}: {
  data: { label: string; passThroughCents: number; traditionalCents: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} tickFormatter={money} width={56} />
        <Tooltip {...tooltipStyle} formatter={(v) => moneyExact(v)} />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
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
          name="Traditional spread (Michigan terms)"
          stroke="#b45309"
          strokeWidth={2.25}
          strokeDasharray="5 3"
          dot={{ r: 2.5 }}
        />
      </LineChart>
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
          stroke="#8493ab"
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

export function WaterfallChart({
  data,
}: {
  data: { label: string; value: number; base: number; kind: "in" | "out" | "total" }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 24 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          {...AXIS}
          interval={0}
          angle={-18}
          textAnchor="end"
          height={56}
        />
        <YAxis {...AXIS} tickFormatter={money} width={56} />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: "#f6f7f9" }}
          formatter={(v, name) => (name === "value" ? moneyExact(v) : null)}
        />
        <Bar dataKey="base" stackId="w" fill="transparent" />
        <Bar dataKey="value" stackId="w" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={
                d.kind === "total"
                  ? "#1d2432"
                  : d.kind === "in"
                    ? "#0f766e"
                    : "#b45309"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
