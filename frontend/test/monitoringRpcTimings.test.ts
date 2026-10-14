import {describe, expect, it} from 'vitest';
import {computeRpcRequestAvgMs} from '@/helpers/monitoringRpcTimings';

describe('computeRpcRequestAvgMs', () => {
    it('ignores non-request timing families stored in rpcTimings', () => {
        expect(
            computeRpcRequestAvgMs({
                'Device.List': {count: 10, avgMs: 25},
                websocket_device_lifetime: {count: 1, avgMs: 300_000},
                'event:Device.Status': {count: 50, avgMs: 2_000},
                'waitingroom.accept.claim': {count: 4, avgMs: 4_000},
                device_ingress_handshake: {count: 8, avgMs: 5_000},
                device_ingress_authenticate: {count: 3, avgMs: 6_000}
            })
        ).toBe(25);
    });

    it('weights RPC method averages by their sample counts', () => {
        expect(
            computeRpcRequestAvgMs({
                'Device.List': {count: 100, avgMs: 10},
                'Device.GetStatus': {count: 1, avgMs: 1_000}
            })
        ).toBe(20);
    });

    it('keeps genuine slow RPC latency visible', () => {
        expect(
            computeRpcRequestAvgMs({
                'Device.List': {count: 4, avgMs: 1_200},
                'Device.GetStatus': {count: 6, avgMs: 1_100}
            })
        ).toBe(1_140);
    });

    it('skips malformed timing entries and returns zero without valid RPC samples', () => {
        expect(
            computeRpcRequestAvgMs({
                'Device.List': {count: 0, avgMs: 25},
                'Device.GetStatus': {count: 2, avgMs: Number.NaN},
                'Device.GetConfig': {count: -1, avgMs: 15},
                'event:Device.Status': {count: 2, avgMs: 5_000}
            })
        ).toBe(0);
        expect(computeRpcRequestAvgMs(null)).toBe(0);
    });
});
