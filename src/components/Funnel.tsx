import type { Metrics } from '../types'
import { Card, SectionTitle, PendingBadge } from './ui'
import { int, pct } from '../lib/format'
import { COLORS } from '../config'

export default function Funnel({ metrics }: { metrics: Metrics }) {
  const m = metrics
  const stages = [
    { label: 'Показы', value: m.impressions, color: COLORS.impressions },
    { label: 'Клики', value: m.clicks, color: COLORS.ctr },
    { label: 'Лиды', value: m.leads, color: COLORS.leads },
  ]
  const max = m.impressions || 1
  const convs = [
    { label: 'CTR', value: m.impressions ? (m.clicks / m.impressions) * 100 : 0 },
    { label: 'Клик → лид', value: m.clicks ? (m.leads / m.clicks) * 100 : 0 },
  ]

  return (
    <Card className="p-5">
      <SectionTitle title="Воронка" subtitle="Показы → Клики → Лиды → Квал-лиды" />
      <div className="space-y-2.5">
        {stages.map((s, i) => {
          // log-ish scale so clicks/leads stay visible next to huge impressions
          const w = Math.max(6, (Math.log10(s.value + 1) / Math.log10(max + 1)) * 100)
          return (
            <div key={s.label}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-mute">{s.label}</span>
                <span className="text-ink tabular font-semibold">{int(s.value)}</span>
              </div>
              <div className="h-8 w-full rounded-lg bg-card2 overflow-hidden">
                <div
                  className="h-full rounded-lg flex items-center px-2"
                  style={{
                    width: `${w}%`,
                    background: `linear-gradient(90deg, ${s.color}cc, ${s.color}77)`,
                  }}
                />
              </div>
              {i < convs.length && (
                <div className="flex justify-center my-1">
                  <span className="text-[11px] text-dim">
                    ↓ {convs[i].label} <span className="text-mute tabular">{pct(convs[i].value)}</span>
                  </span>
                </div>
              )}
            </div>
          )
        })}

        {/* Qual leads — awaiting CRM */}
        <div className="flex items-center justify-between text-sm mb-1 pt-1">
          <span className="text-dim flex items-center gap-2">
            Квал-лиды <PendingBadge />
          </span>
          <span className="text-dim tabular">—</span>
        </div>
        <div className="h-8 w-[6%] rounded-lg bg-card2 border border-dashed border-line" />
      </div>
    </Card>
  )
}
