import { describe, expect, it } from 'vitest';
import { accountEnvironment } from './profiles';

describe('managed Claude account environment', () => {
    it('does not leak global Claude credentials into an isolated child', () => {
        const env = accountEnvironment({ ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'old', PATH: '/bin' }, {
            id: 'work', email: 'work@example.com', configDir: '/tmp/hapi-accounts/work', trustGroup: 'personal'
        });
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
        expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/hapi-accounts/work');
    });
});
