import type { Dataset } from '../types'
import type { Filters, Index } from '../lib/data'
import { stageLadder } from '../lib/data'
import { Card, SectionTitle } from './ui'
import { int, pct } from '../lib/format'
import { COLORS, STAGE_ORDER } from '../config'

/** Stages that mean the lead is gone, so they get a muted colour, not a green one. */
const DEAD = new Set(['Закрыто и не реализовано/спам', 'не отвечает'])

/**
 * Where leads actually sit in the sales pipeline, straight from the CRM stage
 * column. Complements CPQL: the price of a qualified lead says nothing about how
 * many of them are still moving.
 */
export default function SalesFunnel({
  ds,
  idx,
  filters,
}: {
  ds: Dataset
  idx: Index
  filters: Filters
}) {
  const rows = stageLadder(ds, idx, filters, STAGE_ORDER)
  const total = rows.reduce((s, r) => s + r.n, 0)
  const max = Math.max(1, ...rows.map((r) => r.n))

  return (
    <Card className="p-5">
      <SectionTitle
        title="Этапы сделок"
        subtitle={total ? `${int(total)} сделок в CRM за период` : 'Нет сделок за период'}
      />
      {rows.length === 0 ? (
        <div className="py-6 text-center text-dim text-sm">Нет данных за период</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const dead = DEAD.has(r.stage)
            return (
              <div key={r.stage} className="relative">
                <div
                  className="absolute inset-y-0 left-0 rounded-md"
                  style={{
                    width: `${(r.n / max) * 100}%`,
                    background: (dead ? COLORS.dim : COLORS.qual) + '1f',
                  }}
                />
                <div className="relative flex items-center justify-between gap-3 px-2 py-1.5">
                  <span className={`truncate text-sm ${dead ? 'text-dim' : 'text-ink'}`}>
                    {r.stage}
                  </span>
                  <span className="shrink-0 tabular text-sm">
                    <span className={dead ? 'text-dim' : 'text-ink font-medium'}>{int(r.n)}</span>
                    <span className="ml-2 text-dim text-xs">
                      {pct((r.n / (total || 1)) * 100, 1)}
                    </span>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
