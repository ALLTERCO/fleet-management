import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {parseIncomingJsonRpc} from '../src/rpc/types';

describe('parseIncomingJsonRpc', () => {
    it('accepts valid JSON-RPC 2.0 message', () => {
        const msg = {
            jsonrpc: '2.0',
            id: 1,
            src: 'client-1',
            method: 'Device.List',
            params: {}
        };
        assert.ok(parseIncomingJsonRpc(msg));
    });

    it('accepts message without jsonrpc field', () => {
        const msg = {id: 1, src: 'client-1', method: 'Device.List'};
        assert.ok(parseIncomingJsonRpc(msg));
    });

    it('accepts message without params', () => {
        const msg = {id: 1, src: 'client-1', method: 'Device.List'};
        assert.ok(parseIncomingJsonRpc(msg));
    });

    it('accepts message with array dst', () => {
        const msg = {
            id: 1,
            src: 'client-1',
            dst: ['FLEET_MANAGER', 'shellyplus1-abc'],
            method: 'Shelly.GetStatus'
        };
        assert.ok(parseIncomingJsonRpc(msg));
    });

    it('accepts message with string dst', () => {
        const msg = {
            id: 1,
            src: 'client-1',
            dst: 'FLEET_MANAGER',
            method: 'Device.List'
        };
        assert.ok(parseIncomingJsonRpc(msg));
    });

    it('rejects non-object', () => {
        assert.ok(!parseIncomingJsonRpc('string'));
        assert.ok(!parseIncomingJsonRpc(42));
        assert.ok(!parseIncomingJsonRpc(undefined));
    });

    it('rejects missing id', () => {
        assert.ok(!parseIncomingJsonRpc({src: 'c', method: 'M'}));
    });

    it('rejects missing src', () => {
        assert.ok(!parseIncomingJsonRpc({id: 1, method: 'M'}));
    });

    it('rejects missing method', () => {
        assert.ok(!parseIncomingJsonRpc({id: 1, src: 'c'}));
    });

    it('rejects wrong jsonrpc version', () => {
        assert.ok(
            !parseIncomingJsonRpc({
                jsonrpc: '1.0',
                id: 1,
                src: 'c',
                method: 'M'
            })
        );
    });

    it('rejects string id', () => {
        assert.ok(!parseIncomingJsonRpc({id: 'abc', src: 'c', method: 'M'}));
    });

    it('rejects non-object params', () => {
        assert.ok(
            !parseIncomingJsonRpc({id: 1, src: 'c', method: 'M', params: 'bad'})
        );
    });
});
