import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type SkillMarketListing,
  type SkillPackageSummary,
  type SkillShelfCard,
  type SkillShelfInstall,
} from '../../api/client'
import { pressProps } from '../../components/compat'
import { useI18n } from '../../i18n'
import { notify } from '../../notify'

export type SkillMarketFocus = 'remote' | 'local'

type LocalRow = {
  key: string
  name: string
  dir: string
  root: string
  version: string
  intent: string
  pkg?: SkillPackageSummary
  card?: SkillShelfCard
}

/** SkillShelfPanel 技能市场内容区：云端商店，以及文档库与本机货架合并后的本机表。 */
export function SkillShelfPanel({
  onInstalled,
  focus,
}: {
  onInstalled: () => void
  focus: SkillMarketFocus
}) {
  const { t } = useI18n()
  const [cards, setCards] = useState<SkillShelfCard[]>([])
  const [packages, setPackages] = useState<SkillPackageSummary[]>([])
  const [market, setMarket] = useState<SkillMarketListing[]>([])
  const [versionPick, setVersionPick] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const marketSkills = useMemo(() => groupMarket(market), [market])
  const showRemote = focus === 'remote'
  const showLocal = focus === 'local'
  const localRows = useMemo(() => mergeLocalRows(packages, cards), [packages, cards])

  const reload = useCallback(async () => {
    if (showRemote) {
      setMarket(await api.listSkillMarket())
    }
    if (showLocal) {
      const [local, pkgs] = await Promise.all([api.listSkillShelf(), api.listSkillPackages('')])
      setCards(local)
      setPackages(pkgs)
    }
  }, [showLocal, showRemote])

  useEffect(() => {
    void reload().catch((e: Error) => notify.error(e.message))
  }, [reload])

  const publish = async (dir: string) => {
    const rel = dir.trim()
    if (!rel) return
    setBusy(true)
    try {
      const listing = await api.publishSkillMarket(rel)
      notify.success(`${t('skillmarket.publish')}: ${listing.name} ${listing.version}`)
      await reload()
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('没有新的提交') || msg.includes('没有改动')) notify.warning(t('skillmarket.noChange'))
      else notify.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const installLocal = async (card: SkillShelfCard) => {
    setBusy(true)
    try {
      const out: SkillShelfInstall = await api.installSkillShelf(card.id, card.version)
      const where = out.sideBySide ? `${out.rel}（并排，未覆盖原目录）` : out.rel
      notify.success(out.already ? `已经装过 ${where}` : `已安装到 ${where}`)
      await reload()
      onInstalled()
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const installMarket = async (item: SkillMarketListing) => {
    setBusy(true)
    try {
      const out = await api.installSkillMarket(item.id, item.version)
      const where = out.sideBySide ? `${out.rel}（并排，未覆盖原目录）` : out.rel
      notify.success(out.already ? `已经装过 ${where}` : `已安装到 ${where}`)
      await reload()
      onInstalled()
    } catch (e) {
      notify.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const placeOf = (row: LocalRow) => {
    if (row.card?.installed) return t('skillmarket.inNotebook')
    const parts = [
      row.pkg ? t('skillmarket.placeNotebook') : '',
      row.card ? t('skillmarket.placeShelf') : '',
    ].filter(Boolean)
    return parts.join(' · ') || '—'
  }

  return (
    <div className="skill-shelf">
      {showRemote ? (
        <>
          <p className="skill-shelf-intent">{t('skillmarket.navRemote')}</p>
          <p className="skill-shelf-note">{t('skillmarket.remoteHint')}</p>
          {marketSkills.length === 0 ? (
            <p className="pane-meta">{t('skillmarket.remoteEmpty')}</p>
          ) : (
            <div className="skill-shelf-table-wrap">
              <table className="skill-shelf-table">
                <thead>
                  <tr>
                    <th>{t('skillmarket.colName')}</th>
                    <th>{t('skillmarket.colAuthor')}</th>
                    <th>{t('skillmarket.colVersion')}</th>
                    <th>{t('skillmarket.colRoot')}</th>
                    <th>{t('skillmarket.colBind')}</th>
                    <th>{t('skillmarket.colIntent')}</th>
                    <th className="is-action">{t('skillmarket.colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {marketSkills.map((skill) => {
                    const item = pickedMarket(skill, versionPick[skill.id])
                    const summary = item.intent || item.description
                    const limits = (item.limits ?? []).filter(Boolean)
                    return (
                      <tr key={skill.id}>
                        <td className="is-name">
                          {item.name}
                          <span className="skill-shelf-cell-sub skill-shelf-id">{skill.id}</span>
                        </td>
                        <td>{item.authorName || t('skillmarket.anonymous')}</td>
                        <td className="is-mono">
                          {skill.versions.length > 1 ? (
                            <select
                              className="skill-shelf-version"
                              aria-label={t('skillmarket.colVersion')}
                              value={item.version}
                              onChange={(e) =>
                                setVersionPick((prev) => ({ ...prev, [skill.id]: e.target.value }))
                              }
                            >
                              {skill.versions.map((ver) => (
                                <option key={ver.version} value={ver.version}>
                                  {ver.version}
                                </option>
                              ))}
                            </select>
                          ) : (
                            item.version
                          )}
                        </td>
                        <td className="is-mono">{item.root}</td>
                        <td>{item.bind || '—'}</td>
                        <td>
                          {summary ? <span>{summary}</span> : <span className="pane-meta">—</span>}
                          {limits.length ? (
                            <span className="skill-shelf-cell-sub">{limits.join('；')}</span>
                          ) : null}
                        </td>
                        <td className="is-action">
                          <button
                            type="button"
                            className="wn-btn wn-btn-xs"
                            disabled={busy}
                            {...pressProps(() => void installMarket(item), { disabled: busy })}
                          >
                            {t('skillmarket.install')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {showLocal ? (
        <>
          <p className="skill-shelf-note">{t('skillmarket.hint')}</p>
          {localRows.length === 0 ? (
            <p className="pane-meta">{t('skillmarket.localEmpty')}</p>
          ) : (
            <div className="skill-shelf-table-wrap">
              <table className="skill-shelf-table">
                <thead>
                  <tr>
                    <th>{t('skillmarket.colName')}</th>
                    <th>{t('skillmarket.colVersion')}</th>
                    <th>{t('skillmarket.colRoot')}</th>
                    <th>{t('skillmarket.colIntent')}</th>
                    <th>{t('skillmarket.colPlace')}</th>
                    <th className="is-action">{t('skillmarket.colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {localRows.map((row) => {
                    const canInstall = Boolean(row.card) && !row.card?.installed
                    return (
                      <tr key={row.key}>
                        <td className="is-name">{row.name}</td>
                        <td className="is-mono">{row.version || '—'}</td>
                        <td className="is-mono">{row.dir || row.root || '—'}</td>
                        <td>{row.intent || '—'}</td>
                        <td>{placeOf(row)}</td>
                        <td className="is-action">
                          <div className="skill-shelf-actions">
                            {row.pkg ? (
                              <button
                                type="button"
                                className="wn-btn wn-btn-xs"
                                disabled={busy}
                                {...pressProps(() => void publish(row.dir), { disabled: busy })}
                              >
                                {t('skillmarket.publish')}
                              </button>
                            ) : null}
                            {canInstall && row.card ? (
                              <button
                                type="button"
                                className="wn-btn wn-btn-xs"
                                disabled={busy}
                                {...pressProps(() => void installLocal(row.card as SkillShelfCard), {
                                  disabled: busy,
                                })}
                              >
                                {t('skillmarket.install')}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

type MarketSkill = {
  id: string
  versions: SkillMarketListing[]
}

/** groupMarket 云端商店按技能固定 id 收成一行，版本留在行内切换。 */
function groupMarket(list: SkillMarketListing[]): MarketSkill[] {
  const order: string[] = []
  const map = new Map<string, SkillMarketListing[]>()
  for (const item of list) {
    const id = (item.id || '').trim()
    if (!id) continue
    const hit = map.get(id)
    if (hit) hit.push(item)
    else {
      map.set(id, [item])
      order.push(id)
    }
  }
  return order.map((id) => ({
    id,
    versions: dedupeVersions(map.get(id) ?? []),
  }))
}

function dedupeVersions(list: SkillMarketListing[]): SkillMarketListing[] {
  const seen = new Set<string>()
  const out: SkillMarketListing[] = []
  const sorted = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  for (const item of sorted) {
    const version = (item.version || '').trim()
    if (!version || seen.has(version)) continue
    seen.add(version)
    out.push(item)
  }
  return out
}

function pickedMarket(skill: MarketSkill, picked: string | undefined): SkillMarketListing {
  return skill.versions.find((item) => item.version === picked) ?? skill.versions[0]
}

/** mergeLocalRows 按技能目录把文档库里的 Skill 与货架版本合成一行。 */
function mergeLocalRows(packages: SkillPackageSummary[], cards: SkillShelfCard[]): LocalRow[] {
  const rows = new Map<string, LocalRow>()
  for (const pkg of packages) {
    const dir = (pkg.dir || pkg.id || '').trim()
    if (!dir) continue
    rows.set(dir, {
      key: dir,
      name: pkg.name || dir,
      dir,
      root: pkg.root || '',
      version: pkg.version || '',
      intent: pkg.intent || pkg.description || '',
      pkg,
    })
  }
  for (const card of cards) {
    const dir = (card.id || '').trim()
    const key = dir || `${card.name}@${card.version}`
    const hit = dir ? rows.get(dir) : undefined
    if (hit) {
      if (!hit.card) hit.card = card
      if (card.version) hit.version = card.version
      if (!hit.intent) hit.intent = card.intent || card.description || ''
      if (!hit.root) hit.root = card.root || ''
      continue
    }
    rows.set(key, {
      key,
      name: card.name || key,
      dir,
      root: card.root || '',
      version: card.version || '',
      intent: card.intent || card.description || '',
      card,
    })
  }
  return [...rows.values()]
}
