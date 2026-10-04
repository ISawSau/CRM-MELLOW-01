import { shiftDate } from '@shared/data/dates'
import {
  FATIGUE_BASE_DAYS,
  FATIGUE_RECENT_DAYS,
  fatigueOf,
  type FatigueSignal,
  type FatigueWindow,
} from '@shared/growth'
import type { BaseSums } from '@shared/meta'
import type { SqliteDb } from '../db/connection'
import { addDaily, type DailyRow } from '../meta/sums'

export interface FatiguedAd {
  adId: string
  name: string
  accountId: string
  since: string
  until: string
  signal: FatigueSignal
}

const empty = (): FatigueWindow => ({
  impressions: 0,
  linkClicks: 0,
  spend: 0,
  purchases: 0,
  results: 0,
  dailyReach: 0,
})

/**
 * Anuncios activos con señales de fatiga (fase 14, D-106): los últimos días completos frente
 * a la semana anterior, en las cuentas que se sincronizan.
 */
export function fatiguedAds(db: SqliteDb, today: string): FatiguedAd[] {
  const until = shiftDate(today, -1)
  const recentSince = shiftDate(until, -(FATIGUE_RECENT_DAYS - 1))
  const baseUntil = shiftDate(recentSince, -1)
  const baseSince = shiftDate(baseUntil, -(FATIGUE_BASE_DAYS - 1))
  const rows = db
    .prepare(
      `SELECT d.entity_id, d.date, d.spend, d.impressions, d.reach, d.clicks, d.link_clicks,
              d.actions, d.action_values, d.extra, o.name, o.account_id
       FROM ad_insights_daily d
       JOIN ad_objects o ON o.id = d.entity_id
       JOIN ad_accounts a ON a.id = o.account_id
       WHERE d.level = 'ad' AND a.enabled = 1 AND o.effective_status = 'ACTIVE'
         AND d.date BETWEEN ? AND ?`,
    )
    .all(baseSince, until) as (DailyRow & {
    entity_id: string
    date: string
    reach: number | null
    name: string
    account_id: string
  })[]
  const ads = new Map<
    string,
    { name: string; accountId: string; recent: FatigueWindow; base: FatigueWindow }
  >()
  for (const r of rows) {
    let ad = ads.get(r.entity_id)
    if (!ad)
      ads.set(
        r.entity_id,
        (ad = { name: r.name, accountId: r.account_id, recent: empty(), base: empty() }),
      )
    const w = r.date >= recentSince ? ad.recent : ad.base
    const sums: BaseSums = {}
    addDaily(sums, r, (v) => v)
    w.impressions += r.impressions
    w.linkClicks += r.link_clicks ?? 0
    w.spend += r.spend
    w.purchases += sums['compras'] ?? 0
    w.results += sums['resultados'] ?? 0
    w.dailyReach += r.reach ?? 0
  }
  const out: FatiguedAd[] = []
  for (const [adId, ad] of ads) {
    const signal = fatigueOf(ad.recent, ad.base)
    if (signal)
      out.push({ adId, name: ad.name, accountId: ad.accountId, since: recentSince, until, signal })
  }
  return out.sort((a, b) => b.signal.ctrDrop - a.signal.ctrDrop)
}
