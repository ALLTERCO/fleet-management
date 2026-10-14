import assert from 'node:assert/strict';
import test from 'node:test';
import {RedisStream} from '../src/modules/redis/RedisStream';

function pendingStream(reply: unknown | ((cursor: string) => unknown)) {
    let xackCalls = 0;
    const readCursors: string[] = [];
    const client = {
        xreadgroup: async (...args: unknown[]) => {
            const cursor = String(args.at(-1));
            readCursors.push(cursor);
            if (typeof reply === 'function') return reply(cursor);
            return cursor === '0' ? reply : null;
        },
        xack: async () => {
            xackCalls += 1;
            return 1;
        }
    };
    return {
        stream: new RedisStream(client as never, 'test:stream'),
        xackCalls: () => xackCalls,
        readCursors
    };
}

test('readPending decodes normal Redis field pairs', async () => {
    const {stream, xackCalls} = pendingStream([
        ['test:stream', [['1-0', ['kind', 'status', 'value', 'online']]]]
    ]);

    assert.deepEqual(await stream.readPending('group', 'consumer'), [
        {id: '1-0', fields: {kind: 'status', value: 'online'}}
    ]);
    assert.equal(xackCalls(), 0);
});

test('readPending skips a trimmed-stream tombstone without acknowledging it', async () => {
    const {stream, xackCalls} = pendingStream([
        [
            'test:stream',
            [
                ['1-0', null],
                ['2-0', ['kind', 'status']]
            ]
        ]
    ]);

    assert.deepEqual(await stream.readPending('group', 'consumer'), [
        {id: '2-0', fields: {kind: 'status'}}
    ]);
    assert.equal(xackCalls(), 0);
});

test('readPending advances past a tombstone-only page to reach valid pending data', async () => {
    const {stream, xackCalls, readCursors} = pendingStream((cursor) => {
        if (cursor === '0') return [['test:stream', [['1-0', null]]]];
        if (cursor === '1-0') {
            return [['test:stream', [['2-0', ['kind', 'status']]]]];
        }
        return null;
    });

    assert.deepEqual(await stream.readPending('group', 'consumer', 1), [
        {id: '2-0', fields: {kind: 'status'}}
    ]);
    assert.deepEqual(readCursors, ['0', '1-0']);
    assert.equal(xackCalls(), 0);
});

test('readPending skips empty and malformed entries but keeps valid neighbors', async () => {
    const {stream, xackCalls} = pendingStream([
        [
            'test:stream',
            [
                ['1-0', []],
                ['2-0', ['odd']],
                ['3-0', ['kind', 7]],
                ['', ['kind', 'missing-id']],
                ['4-0'],
                null,
                ['5-0', ['kind', 'valid']]
            ]
        ],
        null,
        ['broken-stream-reply']
    ]);

    assert.deepEqual(await stream.readPending('group', 'consumer'), [
        {id: '5-0', fields: {kind: 'valid'}}
    ]);
    assert.equal(xackCalls(), 0);
});

test('readPending bounds tombstone-only pagination', async () => {
    let nextId = 1;
    const {stream, xackCalls, readCursors} = pendingStream(() => {
        const id = `${nextId}-0`;
        nextId += 1;
        return [['test:stream', [[id, null]]]];
    });

    assert.deepEqual(await stream.readPending('group', 'consumer', 1), []);
    assert.equal(readCursors.length, 8);
    assert.equal(xackCalls(), 0);
});
