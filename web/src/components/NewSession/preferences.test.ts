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
    pickRememberedConfig,
    resolveSessionModelParams,
    toNewSessionDefaults,
} from './preferences'

describe('NewSession preferences', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('keeps YOLO off only when the user saved it off', () => {
        localStorage.setItem('hapi:newSession:yolo', 'false')
        expect(loadPreferredYoloMode()).toBe(false)
    })

    it('loads defaults when storage is empty', () => {
        expect(loadPreferredAgent()).toBe('claude')
        expect(loadPreferredYoloMode()).toBe(true)
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
    it('remembers the last Claude account and ignores malformed ids', () => {
        saveLastSessionConfig({ agent: 'claude', claudeAccountId: 'acct-2' })
        expect(loadLastSessionConfig()?.claudeAccountId).toBe('acct-2')

        localStorage.setItem('hapi:newSession:lastConfig', JSON.stringify({ agent: 'claude', claudeAccountId: 'Bad Id!' }))
        expect(loadLastSessionConfig()?.claudeAccountId).toBeUndefined()
    })
})

describe('settings shared through the hub', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    const local = {
        agent: 'claude' as const,
        model: 'sonnet',
        customModel: '',
        thinkEffort: 'high' as const,
        yoloMode: false,
        claudeAccountId: 'account-a',
        sessionType: 'worktree' as const,
        previewUrl: 'http://localhost:4173/',
        savedAt: 1000
    }

    it('takes the newer shared model settings and keeps the per-browser fields', () => {
        const merged = pickRememberedConfig(local, {
            agent: 'claude', model: 'claude-opus-5-5', customModel: '', thinkEffort: 'max', serviceTier: 'auto', yoloMode: true, claudeAccountId: '', updatedAt: 2000
        })
        expect(merged).toEqual({
            agent: 'claude',
            model: 'claude-opus-5-5',
            customModel: '',
            thinkEffort: 'max',
            serviceTier: 'auto',
            yoloMode: true,
            sessionType: 'worktree',
            previewUrl: 'http://localhost:4173/',
            savedAt: 2000
        })
    })

    it('keeps this browser\'s config when it is newer, or when the hub has none', () => {
        expect(pickRememberedConfig(local, { agent: 'claude', model: 'opus', updatedAt: 900 })).toBe(local)
        expect(pickRememberedConfig(local, null)).toBe(local)
        expect(pickRememberedConfig(null, null)).toBeNull()
    })

    it('a model switched in a chat changes only the model', () => {
        const merged = pickRememberedConfig(local, { agent: 'claude', model: 'claude-opus-5-5', customModel: '', updatedAt: 2000 })
        expect(merged).toMatchObject({ model: 'claude-opus-5-5', thinkEffort: 'high', yoloMode: false, claudeAccountId: 'account-a' })
    })

    it('a config saved before this change has no time and loses to the hub', () => {
        const { savedAt: _savedAt, ...old } = local
        expect(pickRememberedConfig(old, { agent: 'claude', model: 'opus', updatedAt: 1 })?.model).toBe('opus')
    })

    it('resolves the form values for the remembered agent', () => {
        expect(resolveSessionModelParams('claude', { agent: 'claude', model: 'claude-opus-5-5', thinkEffort: 'max' })).toEqual({
            model: 'claude-opus-5-5', customModel: '', thinkEffort: 'max', serviceTier: 'auto'
        })
        // A chat model the form does not list is kept as a custom model.
        expect(resolveSessionModelParams('claude', { agent: 'claude', model: 'claude-opus-4-1' })).toMatchObject({
            model: 'auto', customModel: 'claude-opus-4-1'
        })
    })

    it('uses this browser\'s per-agent choice for another agent', () => {
        savePreferredModel('codex', 'gpt-6-sol')
        savePreferredThinkEffort('codex', 'xhigh')
        expect(resolveSessionModelParams('codex', { agent: 'claude', model: 'opus' })).toEqual({
            model: 'gpt-6-sol', customModel: '', thinkEffort: 'xhigh', serviceTier: 'auto'
        })
    })

    it('sends a complete choice, with an empty account for the machine default', () => {
        expect(toNewSessionDefaults({ agent: 'claude', model: 'sonnet', thinkEffort: 'high', serviceTier: 'auto', yoloMode: true })).toEqual({
            agent: 'claude', model: 'sonnet', customModel: '', thinkEffort: 'high', serviceTier: 'auto', yoloMode: true, claudeAccountId: ''
        })
    })
})
