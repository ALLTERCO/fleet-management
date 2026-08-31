// @vitest-environment happy-dom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {loadCustomization} from '../src/shell/customization';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('loadCustomization', () => {
    it('uses defaults when customization is temporarily unavailable', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('temporary network failure'))
        );

        await expect(loadCustomization()).resolves.toMatchObject({
            clientName: 'Fleet Manager',
            title: 'Fleet Manager'
        });
    });
});
