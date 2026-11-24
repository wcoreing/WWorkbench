import { useCallback, useEffect, useState } from 'react'
import { api, type SkillMarketListing, type SkillShelfCard, type SkillShelfInstall } from '../../api/client'
import { pressProps } from '../../components/compat'
import { notify } from '../../notify'

/** SkillShelfPanel 技能商店：上架到账号服务，并从商店安装到笔记本。 */
export function SkillShelfPanel({
  selectedDir,
  onInstalled,
}: {
  selectedDir: string
  onInstalled: () => void
}) {
  const [cards, setCards] = useState<SkillShelfCard[]>([])
  const [market, setMarket] = useState<SkillMarketListing[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const local = await api.listSkillShelf()
    setCards(local)
    const remote = await api.listSkillMarket()
    setMarket(remote)
  }, [])

  useEffect(() => {
    void reload().catch((e: Error) => notify.error(e.message))
  }, [reload])

  const publish = async () => {
    const dir = selectedDir.trim()
    if (!dir) {
      notify.warning('先在左侧选中一个技能目录')
      return
    }
    setBusy(true)
    try {
      const listing = await api.publishSkillMarket(dir)
      notify.success(`已上架 ${listing.name} ${listing.version}`)
      await reload()
    } catch (e) {
      notify.error((e as Error).message)
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

  return (
    <div className="skill-shelf">
      <p className="skill-shelf-note">
        上架会把说明和脚本传到账号服务。账本、截图和密钥不会上传。别人安装后，危险动作仍由对方确认。
      </p>
      <button
        type="button"
        className="wn-btn wn-btn-sm wn-btn-primary"
        disabled={busy || !selectedDir}
        {...pressProps(() => void publish(), { disabled: busy || !selectedDir })}
      >
        上架当前目录
      </button>
      <p className="pane-meta skill-shelf-dir">{selectedDir || '未选中目录'}</p>
      <p className="skill-shelf-intent">商店</p>
      {market.length === 0 ? <p className="pane-meta">商店还是空的。</p> : null}
      <ul className="skill-shelf-list">
        {market.map((item) => (
          <li key={`${item.id}@${item.version}`} className="skill-shelf-card">
            <div className="skill-shelf-card-title">
              <strong>{item.name}</strong>
              <span className="pane-meta">{item.authorName || '未署名'}</span>
            </div>
            <p className="pane-meta">
              {item.root} · {item.version}
              {item.bind ? ` · ${item.bind}` : ''}
            </p>
            {item.intent ? <p className="skill-shelf-intent">{item.intent}</p> : null}
            <ul className="skill-shelf-limits">
              {(item.limits ?? []).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button
              type="button"
              className="wn-btn wn-btn-xs"
              disabled={busy}
              {...pressProps(() => void installMarket(item), { disabled: busy })}
            >
              安装
            </button>
          </li>
        ))}
      </ul>
      <p className="skill-shelf-intent">本机货架</p>
      {cards.length === 0 ? <p className="pane-meta">还没有从商店或目录放进货架的版本。</p> : null}
      <ul className="skill-shelf-list">
        {cards.map((card) => (
          <li key={`local-${card.id}@${card.version}`} className="skill-shelf-card">
            <div className="skill-shelf-card-title">
              <strong>{card.name}</strong>
              <span className="pane-meta">{card.state === 'installed' ? '已安装' : '可安装'}</span>
            </div>
            <p className="pane-meta">
              {card.root} · {card.version}
            </p>
            {card.installedRel ? <p className="pane-meta">{card.installedRel}</p> : null}
            <button
              type="button"
              className="wn-btn wn-btn-xs"
              disabled={busy || card.installed}
              {...pressProps(() => void installLocal(card), { disabled: busy || card.installed })}
            >
              {card.installed ? '已在笔记本' : '安装'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
