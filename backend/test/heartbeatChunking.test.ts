import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

describe('heartbeat chunking logic', () => {
    it('should process all clients across multiple chunks', () => {
        const CHUNK_SIZE = 100;
        const clientCount = 350;
        const pinged: number[] = [];
        const terminated: number[] = [];

        // Simulate clients — stale clients have missedPongs >= 1 so grace is exhausted
        const clients = Array.from({length: clientCount}, (_, i) => ({
            id: i,
            isAlive: i % 50 !== 0, // every 50th client is stale
            missedPongs: i % 50 !== 0 ? 0 : 1, // stale clients already had one grace cycle
            __rpcTransport: undefined as {pendingRpcCount: number} | undefined,
            ping() {
                pinged.push(this.id);
            },
            terminate() {
                terminated.push(this.id);
            },
            emit() {}
        }));

        // Replicate chunked heartbeat logic (synchronous version for testing)
        let offset = 0;
        const chunks: number[] = [];
        while (offset < clients.length) {
            const end = Math.min(offset + CHUNK_SIZE, clients.length);
            chunks.push(end - offset);
            for (let i = offset; i < end; i++) {
                const ws = clients[i];
                if (ws.isAlive === false) {
                    const missed = (ws.missedPongs ?? 0) + 1;
                    ws.missedPongs = missed;
                    const pending = ws.__rpcTransport?.pendingRpcCount ?? 0;
                    if (missed <= 1 && pending > 0) {
                        ws.ping();
                        continue;
                    }
                    ws.terminate();
                    ws.emit();
                    continue;
                }
                ws.missedPongs = 0;
                ws.isAlive = false;
                ws.ping();
            }
            offset = end;
        }

        // Verify all clients were processed
        assert.equal(pinged.length + terminated.length, clientCount);

        // Verify chunking happened correctly
        assert.equal(chunks.length, 4); // 100, 100, 100, 50
        assert.deepEqual(chunks, [100, 100, 100, 50]);

        // Verify stale clients were terminated (ids: 0, 50, 100, 150, 200, 250, 300)
        assert.equal(terminated.length, 7);
        assert.deepEqual(terminated, [0, 50, 100, 150, 200, 250, 300]);

        // Verify alive clients were pinged and marked not alive
        assert.equal(pinged.length, clientCount - 7);
        for (const client of clients) {
            if (!terminated.includes(client.id)) {
                assert.equal(client.isAlive, false);
            }
        }
    });

    it('should defer close when socket has pending RPCs and missed only one cycle', () => {
        const deferred: number[] = [];
        const terminated: number[] = [];
        const pinged: number[] = [];

        const clients = [
            {
                id: 0,
                isAlive: false as boolean,
                missedPongs: 0, // first miss
                __rpcTransport: {pendingRpcCount: 3}, // has pending RPCs
                ping() { pinged.push(this.id); },
                terminate() { terminated.push(this.id); },
                emit() {}
            },
            {
                id: 1,
                isAlive: false as boolean,
                missedPongs: 0, // first miss
                __rpcTransport: {pendingRpcCount: 0}, // no pending RPCs
                ping() { pinged.push(this.id); },
                terminate() { terminated.push(this.id); },
                emit() {}
            },
            {
                id: 2,
                isAlive: false as boolean,
                missedPongs: 1, // second miss — exhausted grace
                __rpcTransport: {pendingRpcCount: 5}, // has pending RPCs but grace used up
                ping() { pinged.push(this.id); },
                terminate() { terminated.push(this.id); },
                emit() {}
            }
        ];

        for (const ws of clients) {
            if (ws.isAlive === false) {
                const missed = (ws.missedPongs ?? 0) + 1;
                ws.missedPongs = missed;
                const pending = ws.__rpcTransport?.pendingRpcCount ?? 0;
                if (missed <= 1 && pending > 0) {
                    deferred.push(ws.id);
                    ws.ping();
                    continue;
                }
                ws.terminate();
                ws.emit();
                continue;
            }
            ws.missedPongs = 0;
            ws.isAlive = false;
            ws.ping();
        }

        // Client 0: deferred (first miss, has pending RPCs) — gets a retry ping
        assert.deepEqual(deferred, [0]);
        assert.deepEqual(pinged, [0]);
        // Client 1: terminated (first miss, but no pending RPCs — no grace)
        // Client 2: terminated (second miss, grace already used up)
        assert.deepEqual(terminated, [1, 2]);
    });

    it('should handle empty client list', () => {
        const CHUNK_SIZE = 100;
        const clients: any[] = [];
        let offset = 0;
        let chunkCount = 0;

        while (offset < clients.length) {
            const end = Math.min(offset + CHUNK_SIZE, clients.length);
            chunkCount++;
            offset = end;
        }

        assert.equal(chunkCount, 0);
    });

    it('should handle fewer clients than chunk size', () => {
        const CHUNK_SIZE = 100;
        const clientCount = 10;
        const pinged: number[] = [];

        const clients = Array.from({length: clientCount}, (_, i) => ({
            id: i,
            isAlive: true,
            missedPongs: 0,
            __rpcTransport: undefined as {pendingRpcCount: number} | undefined,
            ping() {
                pinged.push(this.id);
            },
            terminate() {},
            emit() {}
        }));

        let offset = 0;
        let chunkCount = 0;
        while (offset < clients.length) {
            const end = Math.min(offset + CHUNK_SIZE, clients.length);
            chunkCount++;
            for (let i = offset; i < end; i++) {
                const ws = clients[i];
                if (ws.isAlive === false) {
                    const missed = (ws.missedPongs ?? 0) + 1;
                    ws.missedPongs = missed;
                    const pending = ws.__rpcTransport?.pendingRpcCount ?? 0;
                    if (missed <= 1 && pending > 0) {
                        ws.ping();
                        continue;
                    }
                    ws.terminate();
                    continue;
                }
                ws.missedPongs = 0;
                ws.isAlive = false;
                ws.ping();
            }
            offset = end;
        }

        assert.equal(chunkCount, 1); // single chunk
        assert.equal(pinged.length, clientCount);
    });
});
