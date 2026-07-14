import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend, ReferenceLine,
} from "recharts";
import { fmtCompact, fmtMoney, fmtDateShort, fmtMonthShort } from "../lib/format";
import { SEQ_BLUE, POS, NEG, GRID, MUTED, seriesColor } from "../lib/palette";
import type { NetWorthPoint } from "../lib/api";

function ChartTooltip({ active, payload, label, labelFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-hairline rounded-xl shadow-(--shadow-pop) px-3.5 py-2.5 text-sm">
      <div className="text-xs text-ink-3 mb-1">{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-2">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
            {p.name}
          </span>
          <span className="tnum font-medium">{fmtMoney(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function NetWorthChart({ series, height = 260 }: { series: NetWorthPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SEQ_BLUE[450]} stopOpacity={0.22} />
            <stop offset="100%" stopColor={SEQ_BLUE[450]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDateShort} tickLine={false} axisLine={false} minTickGap={48} />
        <YAxis tickFormatter={(v) => fmtCompact(v)} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<ChartTooltip labelFmt={fmtDateShort} />} />
        <Area
          type="monotone" dataKey="net" name="Net worth"
          stroke={SEQ_BLUE[450]} strokeWidth={2} fill="url(#nwFill)"
          animationDuration={600} dot={false} activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BalanceChart({ history, liability = false, height = 220 }: {
  history: { date: string; balance: number }[]; liability?: boolean; height?: number;
}) {
  const color = liability ? NEG : SEQ_BLUE[450];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={history} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDateShort} tickLine={false} axisLine={false} minTickGap={48} />
        <YAxis tickFormatter={(v) => fmtCompact(v)} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<ChartTooltip labelFmt={fmtDateShort} />} />
        <Area type="monotone" dataKey="balance" name="Balance" stroke={color} strokeWidth={2}
          fill="url(#balFill)" animationDuration={600} dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CashflowChart({ months, height = 260 }: {
  months: { month: string; income: number; expense: number }[]; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tickFormatter={fmtMonthShort} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => fmtCompact(v)} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<ChartTooltip labelFmt={fmtMonthShort} />} cursor={{ fill: "rgba(19,30,51,0.04)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: MUTED }} />
        <Bar dataKey="income" name="Income" fill={POS} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} />
        <Bar dataKey="expense" name="Spending" fill={NEG} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BudgetHistoryChart({ history, height = 240 }: {
  history: { month: string; budgeted: number; spent: number }[]; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={history} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tickFormatter={fmtMonthShort} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => fmtCompact(v)} tickLine={false} axisLine={false} width={58} />
        <Tooltip content={<ChartTooltip labelFmt={fmtMonthShort} />} cursor={{ fill: "rgba(19,30,51,0.04)" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: MUTED }} />
        <Bar dataKey="budgeted" name="Budgeted" fill={SEQ_BLUE[250]} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} />
        <Bar dataKey="spent" name="Spent" fill={SEQ_BLUE[550]} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const MAX_DONUT_SLICES = 8;

export function SpendingDonut({ categories, height = 260 }: {
  categories: { id: number | null; name: string; icon: string; total: number }[]; height?: number;
}) {
  const top = categories.slice(0, MAX_DONUT_SLICES - 1);
  const rest = categories.slice(MAX_DONUT_SLICES - 1);
  const data = [...top];
  if (rest.length) {
    data.push({ id: null, name: "Other", icon: "•", total: rest.reduce((s, c) => s + c.total, 0) });
  }
  const total = data.reduce((s, c) => s + c.total, 0);
  return (
    <div className="flex flex-col sm:flex-row items-center gap-2">
      <div className="relative" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data} dataKey="total" nameKey="name"
              innerRadius="68%" outerRadius="92%" paddingAngle={2}
              stroke="var(--color-card)" strokeWidth={2} animationDuration={600}
            >
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={entry.name === "Other" ? MUTED : seriesColor(i)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <div className="text-[11px] text-ink-3 uppercase tracking-wide">Total</div>
            <div className="tnum text-lg font-semibold">{fmtMoney(total, { cents: false })}</div>
          </div>
        </div>
      </div>
      <ul className="flex-1 w-full space-y-1.5 text-sm" aria-label="Spending by category">
        {data.map((c, i) => (
          <li key={c.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 min-w-0">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.name === "Other" ? MUTED : seriesColor(i) }} />
              <span className="truncate text-ink-2">{c.name}</span>
            </span>
            <span className="tnum text-ink font-medium shrink-0">
              {fmtMoney(c.total, { cents: false })}
              <span className="text-ink-3 font-normal ml-1.5 text-xs">
                {total > 0 ? Math.round((c.total / total) * 100) : 0}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NetBarChart({ months, height = 220 }: {
  months: { month: string; net: number }[]; height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="month" tickFormatter={fmtMonthShort} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => fmtCompact(v)} tickLine={false} axisLine={false} width={58} />
        <ReferenceLine y={0} stroke={MUTED} />
        <Tooltip content={<ChartTooltip labelFmt={fmtMonthShort} />} cursor={{ fill: "rgba(19,30,51,0.04)" }} />
        <Bar dataKey="net" name="Net" radius={[4, 4, 0, 0]} maxBarSize={32} animationDuration={500}>
          {months.map((m) => (
            <Cell key={m.month} fill={m.net >= 0 ? POS : NEG} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
