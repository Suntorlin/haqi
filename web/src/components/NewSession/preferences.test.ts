import { beforeEach, describe, expect, it } from 'vitest'
import {
    loadLastSessionConfig,
    loadPreferredAgent,
    loadPreferredCustomModel,
    loadPreferredModel,
    loadPreferredServiceTier,
    loadPreferredSessionType,
    loadPreferredThinkEffort,
    loadPreferredYoloMode,
    saveLastSessionConfig,
    savePreferredAgent,
    savePreferredCustomModel,
    savePreferredModel,
    savePreferredServiceTier,
    savePreferredSessionType,
    savePreferredThinkEffort,
    savePreferredYoloMode,
} from './preferences'

describe('NewSession preferences', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('loads defaults when storage is empty', () => {
        expect(loadPreferredAgent()).toBe('claude')
        expect(loadPreferredYoloMode()).toBe(false)
        expect(loadPreferredSessionType()).toBe('simple')
        expect(loadPreferredThinkEffort('claude')).toBeNull()
        expect(loadPreferredServiceTier('codex')).toBeNull()
        expect(loadPreferredModel('claude')).toBeNull()
        expect(loadPreferredCustomModel('claude')).toBe('')
    })

    it('loads saved values from storage', () => {
        localStorage.setItem('hapi:newSession:agent', 'codex')
        localStorage.setItem('hapi:newSession:yolo', 'true')
        localStorage.setItem('hapi:newSession:sessionType', 'worktree')
        localStorage.setItem('hapi:newSession:thinkEffortByAgent', JSON.stringify({
            codex: 'medium'
        }))
        localStorage.setItem('hapi:newSession:serviceTierByAgent', JSON.stringify({
            codex: 'fast'
        }))
        localStorage.setItem('hapi:newSession:modelByAgent', JSON.stringify({
            codex: 'gpt-5.3-codex'
        }))
        localStorage.setItem('hapi:newSession:customModelByAgent', JSON.stringify({
            codex: 'my-custom-model'
        }))

        expect(loadPreferredAgent()).toBe('codex')
        expect(loadPreferredYoloMode()).toBe(true)
        expect(loadPreferredSessionType()).toBe('worktree')
        expect(loadPreferredThinkEffort('codex')).toBe('medium')
        expect(loadPreferredServiceTier('codex')).toBe('fast')
        expect(loadPreferredModel('codex')).toBe('gpt-5.3-codex')
        expect(loadPreferredCustomModel('codex')).toBe('my-custom-model')
    })

    it('falls back to default agent on invalid stored value', () => {
        localStorage.setItem('hapi:newSession:agent', 'unknown-agent')

        expect(loadPreferredAgent()).toBe('claude')
    })

    it('falls back to default session type on invalid stored value', () => {
        localStorage.setItem('hapi:newSession:sessionType', 'unknown')
        expect(loadPreferredSessionType()).toBe('simple')
    })

    it('returns null on invalid stored model/think values', () => {
        localStorage.setItem('hapi:newSession:thinkEffortByAgent', JSON.stringify({
            claude: 'ultra-think'
        }))
        localStorage.setItem('hapi:newSession:modelByAgent', JSON.stringify({
            claude: 'unknown-model'
        }))

        expect(loadPreferredThinkEffort('claude')).toBeNull()
        expect(loadPreferredModel('claude')).toBeNull()
    })

    it('persists new values to storage', () => {
        savePreferredAgent('gemini')
        savePreferredYoloMode(true)
        savePreferredSessionType('worktree')
        savePreferredThinkEffort('codex', 'high')
        savePreferredServiceTier('codex', 'flex')
        savePreferredModel('codex', 'gpt-5.5')
        savePreferredCustomModel('codex', 'my-custom-model')

        expect(localStorage.getItem('hapi:newSession:agent')).toBe('gemini')
        expect(localStorage.getItem('hapi:newSession:yolo')).toBe('true')
        expect(localStorage.getItem('hapi:newSession:sessionType')).toBe('worktree')
        expect(localStorage.getItem('hapi:newSession:thinkEffortByAgent')).toBe(JSON.stringify({
            codex: 'high'
        }))
        expect(localStorage.getItem('hapi:newSession:serviceTierByAgent')).toBe(JSON.stringify({
            codex: 'flex'
        }))
        expect(localStorage.getItem('hapi:newSession:modelByAgent')).toBe(JSON.stringify({
            codex: 'gpt-5.5'
        }))
        expect(localStorage.getItem('hapi:newSession:customModelByAgent')).toBe(JSON.stringify({
            codex: 'my-custom-model'
        }))
    })

    it('clears custom model preference when saving empty text', () => {
        savePreferredCustomModel('claude', 'old-value')
        savePreferredCustomModel('claude', '   ')
        expect(loadPreferredCustomModel('claude')).toBe('')
    })

    it('loads and saves last session config', () => {
        saveLastSessionConfig({
            agent: 'codex',
            model: 'gpt-5.3-codex',
            customModel: 'custom-model',
            thinkEffort: 'high',
            serviceTier: 'fast',
            yoloMode: true,
            sessionType: 'worktree',
            worktreeName: 'feat-branch',
            previewUrl: 'http://localhost:3000'
        })

        expect(loadLastSessionConfig()).toEqual({
            agent: 'codex',
            model: 'gpt-5.3-codex',
            customModel: 'custom-model',
            thinkEffort: 'high',
            serviceTier: 'fast',
            yoloMode: true,
            sessionType: 'worktree',
            worktreeName: 'feat-branch',
            previewUrl: 'http://localhost:3000'
        })
    })
})
