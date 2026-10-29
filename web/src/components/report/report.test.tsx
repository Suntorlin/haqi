import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { AgentTimeline, Checklist, CompareTable, DecisionCard, EvidenceList, LeadComposer, ProgressList, VerdictBar } from './index'
import type { Decision, ProgressItem } from './types'

function renderWithProviders(ui: React.ReactElement) {
    return render(<I18nProvider>{ui}</I18nProvider>)
}

const DECISION: Decision = {
    id: 'd1',
    question: '旧支付接口还留着吗？',
    context: '新接口已经上线。',
    basis: ['近 7 天调用 4,213 次'],
    source: { seed: 'pay', name: '支付重构', meta: '等了 12 分钟' },
    options: [
        { label: '留一个月', good: '客户不用改', cost: '多维护一个月', recommended: true },
        { label: '现在删', good: '少 1,200 行代码', cost: '客户要马上改' }
    ]
}

beforeEach(() => {
    const localStorageMock = {
        getItem: vi.fn(() => 'zh-CN'),
        setItem: vi.fn(),
        removeItem: vi.fn()
    }
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })
})

afterEach(cleanup)

describe('DecisionCard', () => {
    it('preselects the recommended option and answers with it', () => {
        const onAnswer = vi.fn()
        renderWithProviders(<DecisionCard decision={DECISION} onAnswer={onAnswer} showSource />)
        expect(screen.getByText('支付重构')).toBeTruthy()
        const pressed = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true')
        expect(pressed).toHaveLength(1)
        expect(pressed[0].textContent).toContain('留一个月')
        fireEvent.click(screen.getByRole('button', { name: '就选「留一个月」' }))
        expect(onAnswer).toHaveBeenCalledWith(DECISION.options[0])
    })

    it('switching the option changes the primary button label', () => {
        renderWithProviders(<DecisionCard decision={DECISION} onAnswer={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /少 1,200 行代码/ }))
        expect(screen.getByRole('button', { name: '就选「现在删」' })).toBeTruthy()
    })

    it('asks back in the card itself: the field opens, the text goes to onAsk', async () => {
        const onAsk = vi.fn()
        renderWithProviders(<DecisionCard decision={DECISION} onAnswer={() => {}} onAsk={onAsk} />)
        fireEvent.click(screen.getByRole('button', { name: '问一下' }))
        const field = screen.getByRole('textbox', { name: '想先问清楚什么？' })
        expect(document.activeElement).toBe(field)
        fireEvent.change(field, { target: { value: '留一个月要多少钱？' } })
        fireEvent.click(screen.getByRole('button', { name: '发给提问的人' }))
        await waitFor(() => expect(onAsk).toHaveBeenCalledWith('留一个月要多少钱？'))
        await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
    })

    it('shows the question the user asked back', () => {
        renderWithProviders(<DecisionCard decision={{ ...DECISION, asked: '要多少钱？' }} onAnswer={() => {}} />)
        expect(screen.getByText('你问了：「要多少钱？」。等回答，回答会替换这张卡。')).toBeTruthy()
    })
})

describe('ProgressList', () => {
    const ITEMS: ProgressItem[] = [
        { id: 'pay', name: '支付重构', status: '等你定旧接口', tone: 'wait', done: 3, total: 5 },
        { id: 'docs', name: '文档迁移', status: '做完了', tone: 'done', done: 3, total: 3, when: '10:42' }
    ]

    it('shows counts for live goals and the time for done goals', () => {
        renderWithProviders(<ProgressList items={ITEMS} onOpen={() => {}} />)
        expect(screen.getByText('3/5')).toBeTruthy()
        expect(screen.getByText('10:42')).toBeTruthy()
    })

    it('opens the tapped goal', () => {
        const onOpen = vi.fn()
        renderWithProviders(<ProgressList items={ITEMS} onOpen={onOpen} />)
        fireEvent.click(screen.getByRole('button', { name: /支付重构/ }))
        expect(onOpen).toHaveBeenCalledWith(ITEMS[0])
    })
})

describe('Checklist', () => {
    it('shows the waiting badge and opens live rows', () => {
        const onClick = vi.fn()
        renderWithProviders(
            <Checklist
                items={[
                    { title: '回归测试', state: 'live', trailing: '142 / 180', onClick },
                    { title: '灰度上线', state: 'wait', waiting: true }
                ]}
            />
        )
        expect(screen.getByText('等你')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: /回归测试/ }))
        expect(onClick).toHaveBeenCalled()
    })
})

describe('VerdictBar', () => {
    it('fires the handlers and swaps to the verdict line', () => {
        const onApprove = vi.fn()
        const { rerender } = renderWithProviders(<VerdictBar onApprove={onApprove} onRequestChanges={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: '通过' }))
        expect(onApprove).toHaveBeenCalled()
        rerender(
            <I18nProvider>
                <VerdictBar onApprove={onApprove} onRequestChanges={() => {}} verdict="已通过" />
            </I18nProvider>
        )
        expect(screen.getByText('已通过')).toBeTruthy()
        expect(screen.queryByRole('button', { name: '通过' })).toBeNull()
    })
})

describe('LeadComposer', () => {
    it('sends the draft with the send button, mic shown when empty', () => {
        const onSend = vi.fn()
        const { rerender } = renderWithProviders(
            <LeadComposer latest={{ from: 'lead', text: '回归测试还要 20 分钟。', when: '2 分钟前' }} draft="" onDraft={() => {}} onSend={onSend} />
        )
        expect(screen.getByText(/负责人 · 2 分钟前/)).toBeTruthy()
        expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
        rerender(
            <I18nProvider>
                <LeadComposer latest={{ from: 'me', text: '好', when: '刚刚' }} draft="收到" onDraft={() => {}} onSend={onSend} />
            </I18nProvider>
        )
        fireEvent.click(screen.getByRole('button', { name: '发送' }))
        expect(onSend).toHaveBeenCalled()
    })
})

describe('AgentTimeline', () => {
    const agents = [
        { id: 'w', name: '写手', tone: 'wait' as const, progress: 0.5, spans: [{ from: -12, to: 0, state: 'wait' as const, label: '等你选标题' }], steps: [{ from: -12, to: 0, state: 'wait' as const, label: '等你选' }] },
        { id: 'e', name: '工程师', tone: 'live' as const, progress: 0.7, spans: [{ from: -25, to: 0, state: 'live' as const, label: '跑测试' }] }
    ]

    it('counts who waits and opens the decision from the waiting stretch', () => {
        const onDecide = vi.fn()
        renderWithProviders(<AgentTimeline agents={agents} onDecide={onDecide} />)
        expect(screen.getByText(/1 个等你/)).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /等你选标题/ }))
        expect(onDecide).toHaveBeenCalledWith(agents[0])
    })

    it('shows the steps only in the steps view', () => {
        renderWithProviders(<AgentTimeline agents={agents} />)
        expect(screen.queryByText('等你选')).not.toBeInTheDocument()
        fireEvent.click(screen.getByRole('radio', { name: '步骤' }))
        expect(screen.getByText('等你选')).toBeInTheDocument()
    })
})

describe('CompareTable and EvidenceList', () => {
    it('marks the recommended option', () => {
        renderWithProviders(
            <CompareTable title="方案" columns={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B', recommended: true }]} rows={[{ label: '月费', values: { a: '$8', b: '$12' } }]} />
        )
        expect(screen.getAllByText('建议').length).toBeGreaterThan(0)
    })

    it('folds evidence until the row is opened', () => {
        renderWithProviders(<EvidenceList items={[{ id: 'c', kind: 'command', title: '52 个测试', meta: 'bun test', lines: ['✗ webhook retries'] }]} />)
        const row = screen.getByRole('button', { name: /52 个测试/ })
        expect(row).toHaveAttribute('aria-expanded', 'false')
        fireEvent.click(row)
        expect(row).toHaveAttribute('aria-expanded', 'true')
    })
})
