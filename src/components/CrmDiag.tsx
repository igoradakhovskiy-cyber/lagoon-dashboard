import { useState } from 'react'
import type { Dataset } from '../types'
import { int } from '../lib/format'
import { COLORS } from '../config'

/**
 * Data-quality strip for the CRM join. Always reports the whole window (not the
 * selected period) — it answers "can I trust these numbers?", not "how did last
 * week go?". Unmatched rows are shown with their reasons rather than dropped
 * silently, so a broken UTM never looks like a bad week.
 */
export default function CrmDiag({ ds }: { ds: Dataset }) {
  const [open, setOpen] = useState(false)
  if (!ds.crm) return null
  const c = ds.crm
  const metaLeads = ds.daily.reduce((s, r) => s + r.leads, 0)
  const u = c.unmatched
  const skipped = u.macro + u.unknown_campaign + u.no_utm
  const gap = c.rows_matched - metaLeads

  // The join is exact (UTM carries campaign/adset ids), so the interesting number
  // is not the match rate but whether the two sources count the same leads at all.
  const drift = metaLeads ? Math.abs(gap / metaLeads) * 100 : 0
  const tone = skipped === 0 && drift <= 10 ? COLORS.pos : drift <= 25 ? COLORS.warn : COLORS.neg

  const reasons: { label: string; n: number; note: string }[] = [
    {
      label: 'кампания вне периода дашборда',
      n: u.unknown_campaign,
      note: 'лиды со старых флайтов — их расход в окно не входит, поэтому в CPQL они не считаются',
    },
    {
      label: 'UTM не подставился',
      n: u.macro,
      note: 'в CRM пришло буквально {{campaign.name}} — Meta не раскрыла макрос',
    },
    {
      label: 'без креатива',
      n: u.unknown_ad,
      note: 'в ссылке не было utm_content — лид засчитан кампании и стране, но в галерее креативов не показан',
    },
    { label: 'без UTM', n: u.no_utm, note: 'заявка пришла не из рекламы' },
    {
      label: 'страна не распознана',
      n: u.unknown_country,
      note: 'написание из CRM отсутствует в справочнике — строка не попала в таблицу географии',
    },
  ].filter((r) => r.n > 0)

  return (
    <div className="bento px-4 py-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: tone }} />
          <span className="text-mute">
            CRM сопоставлена с рекламой:{' '}
            <span className="text-ink tabular font-medium">
              {int(c.rows_matched)} из {int(c.rows_in_window)}
            </span>{' '}
            строк · креатив определён у{' '}
            <span className="text-ink tabular font-medium">
              {int(c.ads_resolved)}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-xs text-dim">
          {skipped > 0 && `${int(skipped)} не сопоставлено`}
          <span
            className="ml-2 inline-block transition-transform"
            style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          >
            ▸
          </span>
        </span>
      </button>

      {open && (
        <div className="mt-3 border-t border-line2 pt-3 space-y-2 text-xs">
          <p className="text-mute">
            Джойн идёт по <span className="text-ink">ID кампании и адсета</span> из UTM-меток
            (<span className="text-dim">utm_id</span>, <span className="text-dim">utm_term</span>), а
            не по названиям — поэтому переименование кампании его не сломает. Креатив берётся из{' '}
            <span className="text-dim">utm_content</span> в ссылке перехода.
          </p>
          {reasons.map((r) => (
            <div key={r.label} className="flex items-start gap-3">
              <span className="w-8 shrink-0 text-right tabular font-medium text-ink">
                {int(r.n)}
              </span>
              <span className="text-mute">
                {r.label} — <span className="text-dim">{r.note}</span>
              </span>
            </div>
          ))}
          <p className="text-dim pt-1">
            Meta засчитала за период <span className="text-mute tabular">{int(metaLeads)}</span>{' '}
            лид(ов), в CRM попало <span className="text-mute tabular">{int(c.rows_matched)}</span>
            {gap !== 0 && (
              <>
                {' '}
                — расхождение {gap > 0 ? '+' : ''}
                {int(gap)}
              </>
            )}
            . Небольшая разница нормальна: Meta считает по клику, CRM — по факту создания сделки, и
            дубли схлопываются. Всего строк в выгрузке {int(c.rows_total)}, из них в периоде
            дашборда {int(c.rows_in_window)}.
          </p>
        </div>
      )}
    </div>
  )
}
