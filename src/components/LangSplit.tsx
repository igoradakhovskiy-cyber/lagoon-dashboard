import type { DailyRow, Metrics } from '../types'
import type { Index } from '../lib/data'
import { splitByLang } from '../lib/data'
import { Card, SectionTitle } from './ui'
import { int, money, moneySmart, pct } from '../lib/format'
import { COLORS } from '../config'

export default function LangSplit({
  rows,
  idx,
  total,
}: {
  rows: DailyRow[]
  idx: Index
  total: Metrics
}) {
  const split = splitByLang(rows, idx)
  const totalSpend = total.spend || 1

  return (
    <Card className="p-5">
      <SectionTitle title="Потоки EN / RU" subtitle="Разбивка по языку кампаний" />

      {/* share bar */}
      <div className="flex h-2.5 w-full rounded-full overflow-hidden mb-4 bg-card2">
        {split.map((s) => (
          <div
            key={s.lang}
            style={{
              width: `${(s.metrics.spend / totalSpend) * 100}%`,
              background: s.lang === 'en' ? COLORS.en : COLORS.ru,
            }}
          />
        ))}
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-dim">
              <th className="font-medium py-1.5 pl-1">Поток</th>
              <th className="font-medium py-1.5 text-right">Расход</th>
              <th className="font-medium py-1.5 text-right">Доля</th>
              <th className="font-medium py-1.5 text-right">Лиды</th>
              <th className="font-medium py-1.5 text-right">CPL</th>
              <th className="font-medium py-1.5 text-right pr-1">CTR</th>
            </tr>
          </thead>
          <tbody>
            {split.map((s) => (
              <tr key={s.lang} className="border-t border-line2">
                <td className="py-2 pl-1">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: s.lang === 'en' ? COLORS.en : COLORS.ru }}
                    />
                    <span className="font-medium text-ink">{s.lang === 'en' ? 'EN' : 'RU'}</span>
                  </span>
                </td>
                <td className="py-2 text-right tabular text-ink">{money(s.metrics.spend)}</td>
                <td className="py-2 text-right tabular text-mute">
                  {pct((s.metrics.spend / totalSpend) * 100, 1)}
                </td>
                <td className="py-2 text-right tabular text-ink">{int(s.metrics.leads)}</td>
                <td className="py-2 text-right tabular text-ink">{moneySmart(s.metrics.cpl)}</td>
                <td className="py-2 text-right tabular text-mute pr-1">{pct(s.metrics.ctr)}</td>
              </tr>
            ))}
            {split.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-dim">
                  Нет данных за период
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
