import {describe, expect, it} from 'vitest';
import {isRecoverableReconnectError} from '@/tools/wsReconnectErrors';

describe('isRecoverableReconnectError', () => {
    it('classifies sleep and reconnect failures as recoverable', () => {
        expect(isRecoverableReconnectError(new Error('WebSocket closed'))).toBe(
            true
        );
        expect(
            isRecoverableReconnectError(new Error('RPC timeout after 30000ms'))
        ).toBe(true);
    });

    it('does not hide unrelated failures', () => {
        expect(
            isRecoverableReconnectError(new Error('permission denied'))
        ).toBe(false);
    });
});
