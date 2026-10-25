import { describe, expect, it } from 'vitest'
import { parseEnv } from './MachinesSettings'

describe('parseEnv', () => {
    it('reads KEY=VALUE lines and skips blanks and comments', () => {
        expect(parseEnv('# test db\nTEST_DB_URL=mongodb://h:1/?a=b\n\n  MODE = fast ')).toEqual({ env: { TEST_DB_URL: 'mongodb://h:1/?a=b', MODE: 'fast' } })
    })

    it('points at the first bad line', () => {
        expect(parseEnv('OK=1\nnot a pair')).toEqual({ badLine: 'not a pair' })
        expect(parseEnv('lower=1')).toEqual({ badLine: 'lower=1' })
    })
})
