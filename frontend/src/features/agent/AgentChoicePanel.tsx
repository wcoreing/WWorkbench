import { useEffect, useMemo, useState } from 'react'
import {
  formatChoiceSendText,
  joinChoiceSendTexts,
  type AgentChoiceQuestion,
  type ChoiceAnswer,
} from './agentChoice'
import { useI18n } from '../../i18n'

export type ChoiceSubmitAnswer = {
  pendingId?: string
  keys: string[]
  text: string
}

interface Props {
  questions: AgentChoiceQuestion[]
  /** 历史气泡 / 忙碌时不可点 */
  disabled?: boolean
  /** 将选项写入侧栏输入框（Markdown 兜底路径） */
  onDraft?: (text: string) => void
  /**
   * 工具 offer_choices 路径：点选后直接提交续跑。
   * 有 onSubmit 时优先走提交，不再只填输入框。
   */
  onSubmit?: (answers: ChoiceSubmitAnswer[]) => void
}

/** AgentChoicePanel 渲染助手挂出的可点选项（对齐 AgentDesk desk-choice）。 */
export function AgentChoicePanel({ questions, disabled, onDraft, onSubmit }: Props) {
  const { t } = useI18n()
  const [answers, setAnswers] = useState<Record<number, ChoiceAnswer>>({})

  const qKey = questions.map((q) => `${q.n}:${q.id || q.prompt}:${q.mode}`).join('|')
  useEffect(() => {
    const next: Record<number, ChoiceAnswer> = {}
    for (const q of questions) {
      next[q.n] = { keys: [], text: '' }
    }
    setAnswers(next)
    // 仅题目集合变化时重置；questions 随 qKey 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey])

  const sendTexts = useMemo(() => {
    const out: string[] = []
    for (const q of questions) {
      const a = answers[q.n]
      if (!a) continue
      const text = formatChoiceSendText(q, a)
      if (text) out.push(text)
    }
    return out
  }, [questions, answers])

  const canSendAll = sendTexts.length === questions.length && sendTexts.every(Boolean) && !disabled
  const needBatch = questions.some((q) => q.mode === 'multi') || questions.length > 1
  const toolMode = typeof onSubmit === 'function'

  const toSubmitPayload = (next: Record<number, ChoiceAnswer>): ChoiceSubmitAnswer[] =>
    questions.map((q) => {
      const a = next[q.n] ?? { keys: [], text: '' }
      return {
        pendingId: q.id,
        keys: a.keys ?? [],
        text: (a.text ?? '').trim(),
      }
    })

  const pushDraft = (next: Record<number, ChoiceAnswer>) => {
    if (!onDraft) return
    const body = joinChoiceSendTexts(questions, next)
    if (body) onDraft(body)
  }

  const submitNow = (next: Record<number, ChoiceAnswer>) => {
    if (!onSubmit || disabled) return
    onSubmit(toSubmitPayload(next))
  }

  const pickSingle = (q: AgentChoiceQuestion, key: string) => {
    if (disabled) return
    if (needBatch) {
      setAnswers((prev) => {
        const next = { ...prev, [q.n]: { keys: [key], text: '' } }
        if (!toolMode) pushDraft(next)
        return next
      })
      return
    }
    const next = { ...answers, [q.n]: { keys: [key], text: '' } }
    setAnswers(next)
    if (toolMode) {
      submitNow(next)
      return
    }
    const opt = q.options.find((o) => o.key === key)
    const label = (opt?.label || '').trim()
    if (label && onDraft) onDraft(label)
  }

  const toggleMulti = (q: AgentChoiceQuestion, key: string) => {
    if (disabled) return
    setAnswers((prev) => {
      const cur = prev[q.n] ?? { keys: [], text: '' }
      const keys = [...(cur.keys ?? [])]
      const i = keys.indexOf(key)
      if (i >= 0) keys.splice(i, 1)
      else keys.push(key)
      const next = { ...prev, [q.n]: { ...cur, keys } }
      if (!toolMode) pushDraft(next)
      return next
    })
  }

  const submitText = (q: AgentChoiceQuestion) => {
    if (disabled) return
    const text = formatChoiceSendText(q, answers[q.n] ?? {})
    if (!text) return
    if (needBatch) {
      setAnswers((prev) => {
        const next = { ...prev, [q.n]: { ...(prev[q.n] ?? { keys: [] }), text } }
        if (!toolMode) pushDraft(next)
        return next
      })
      return
    }
    const next = { ...answers, [q.n]: { keys: [], text } }
    setAnswers(next)
    if (toolMode) {
      submitNow(next)
      return
    }
    onDraft?.(text)
  }

  const sendAll = () => {
    if (!canSendAll) return
    if (toolMode) {
      submitNow(answers)
      return
    }
    const body = joinChoiceSendTexts(questions, answers)
    if (body) onDraft?.(body)
  }

  const isSelected = (q: AgentChoiceQuestion, key: string) => {
    const keys = answers[q.n]?.keys || []
    if (q.mode === 'multi') return keys.includes(key)
    return keys[0] === key
  }

  return (
    <div className={`agent-choice${disabled ? ' is-disabled' : ''}`}>
      <div className="agent-choice-head">{t('agent.choiceTitle')}</div>
      {questions.map((q) => (
        <div key={`${q.n}-${q.id || q.prompt}`} className="agent-choice-q">
          <div className="agent-choice-prompt">
            <span className="agent-choice-n">{q.n}.</span>
            {q.prompt}
          </div>
          {q.mode === 'text' ? (
            <div className="agent-choice-text-row">
              <input
                className="agent-choice-input"
                type="text"
                placeholder={q.placeholder || t('agent.choicePlaceholder')}
                disabled={disabled}
                value={answers[q.n]?.text || ''}
                onChange={(e) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [q.n]: { ...(prev[q.n] ?? { keys: [] }), text: e.target.value },
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitText(q)
                  }
                }}
              />
              <button
                type="button"
                className="wn-btn wn-btn-xs"
                disabled={disabled || !(answers[q.n]?.text || '').trim()}
                onClick={() => submitText(q)}
              >
                {toolMode ? t('agent.choiceConfirm') : t('agent.choiceSend')}
              </button>
            </div>
          ) : (
            <div className="agent-choice-opts">
              {q.options.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`agent-choice-opt${isSelected(q, opt.key) ? ' is-on' : ''}${
                    q.mode === 'multi' ? ' is-multi' : ''
                  }`}
                  disabled={disabled}
                  title={opt.label}
                  onClick={() =>
                    q.mode === 'multi' ? toggleMulti(q, opt.key) : pickSingle(q, opt.key)
                  }
                >
                  <span className="agent-choice-key">{opt.key}</span>
                  <span className="agent-choice-label">{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {needBatch && (
        <div className="agent-choice-foot">
          <button
            type="button"
            className="wn-btn wn-btn-xs wn-btn-primary"
            disabled={!canSendAll}
            onClick={sendAll}
          >
            {toolMode ? t('agent.choiceConfirm') : t('agent.choiceApplyInput')}
            {sendTexts.length ? `（${sendTexts.length}/${questions.length}）` : ''}
          </button>
        </div>
      )}
    </div>
  )
}
