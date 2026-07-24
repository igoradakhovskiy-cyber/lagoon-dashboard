import type { Dataset, Metrics } from '../types'
import { aggregate } from '../lib/data'
import { int, money, moneySmart, pct } from '../lib/format'
import { Card, PendingBadge } from './ui'
import { COLORS } from '../config'

function Progress({ value, target, color }: { value: number; target: number; color: string }) {
  const p = target > 0 ? Math.min(100, (value / target) * 100) : 0
  return (
    <div className="mt-2 h-1.5 w-full rounded-full bg-card2 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${p}%`, background: color }} />
    </div>
  )
}

function Hero({
  label,
  value,
  accent,
  children,
}: {
  label: string
  value: string
  accent: string
  children?: React.ReactNode
}) {
  return (
    <Card className="p-4 relative overflow-hidden">
      <div
        className="absolute -right-6 -top-8 h-24 w-24 rounded-full blur-2xl opacity-20"
        style={{ background: accent }}
      />
      <div className="text-xs font-medium text-mute uppercase tracking-wide">{label}</div>
      <div className="mt-1.5 font-display text-3xl font-bold text-ink tabular">{value}</div>
      {children}
    </Card>
  )
}

function Stat({
  label,
  value,
  accent = COLORS.mute,
  pending = false,
}: {
  label: string
  value: string
  accent?: string
  pending?: boolean
}) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-mute uppercase tracking-wide">{label}</div>
        {pending && <PendingBadge />}
      </div>
      <div
        className="mt-1 font-display text-xl font-semibold tabular"
        style={{ color: pending ? COLORS.dim : accent }}
      >
        {value}
      </div>
    </Card>
  )
}

export default function KpiGrid({ ds, metrics }: { ds: Dataset; metrics: Metrics }) {
  const m = metrics
  // Plan progress = month-to-date of the latest data month (all languages).
  const monthPrefix = ds.date_max.slice(0, 7)
  const month = aggregate(ds.daily.filter((r) => r.date.startsWith(monthPrefix)))

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Hero label="Расход" value={money(m.spend)} accent={COLORS.spend}>
          <div className="mt-3 text-[11px] text-dim">
            план месяца {money(ds.plan.budget)} · {pct((month.spend / ds.plan.budget) * 100, 1)}
          </div>
          <Progress value={month.spend} target={ds.plan.budget} color={COLORS.spend} />
        </Hero>

        <Hero label="Лиды" value={int(m.leads)} accent={COLORS.leads}>
          <div className="mt-3 text-[11px] text-dim">
            план месяца {int(ds.plan.leads)} · {pct((month.leads / ds.plan.leads) * 100, 1)}
          </div>
          <Progress value={month.leads} target={ds.plan.leads} color={COLORS.leads} />
        </Hero>

        <Hero label="Цена лида (CPL)" value={moneySmart(m.cpl)} accent={COLORS.cpl}>
          <div className="mt-3 text-[11px] text-dim">
            цель ≤ {money(ds.plan.cpl)} ·{' '}
            <span style={{ color: m.cpl <= ds.plan.cpl ? COLORS.pos : COLORS.neg }}>
              {m.cpl <= ds.plan.cpl ? 'в цели' : 'выше цели'}
            </span>
          </div>
          <Progress
            value={ds.plan.cpl}
            target={Math.max(m.cpl, ds.plan.cpl)}
            color={m.cpl <= ds.plan.cpl ? COLORS.pos : COLORS.neg}
          />
        </Hero>

        <Card className="p-4">
          <div className="text-xs font-medium text-mute uppercase tracking-wide">Охват периода</div>
          <div className="mt-2 space-y-2 text-sm">
            <Row label="Показы" value={int(m.impressions)} />
            <Row label="Клики" value={int(m.clicks)} />
            <Row label="CTR" value={pct(m.ctr)} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Stat label="CPM" value={moneySmart(m.cpm)} accent={COLORS.ink} />
        <Stat label="CPC" value={moneySmart(m.cpc)} accent={COLORS.ink} />
        <Stat label="CTR" value={pct(m.ctr)} accent={COLORS.ctr} />
        <Stat label="Клики" value={int(m.clicks)} accent={COLORS.ink} />
        <Stat label="Квал-лиды" value="—" pending />
        <Stat label="Цена квал-лида" value="—" pending />
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-mute">{label}</span>
      <span className="text-ink tabular font-medium">{value}</span>
    </div>
  )
}
