// Unit tests for the universal-device-event subscription API + dispatcher.
// Backend emits NotifyEvent variants without a dedicated handler as
// `Shelly.Event.<component>.<event>` carrying `{component, event, attrs,
// schema}` in params. Frontend code subscribes via onDeviceEvent.

import {describe, expect, it, vi} from 'vitest';
import {
    type DeviceEventPayload,
    handleDeviceEvent,
    onDeviceEvent
} from '@/tools/websocket';
import type {json_rpc_event} from '@/types/rpc';

function payload(
    component: string,
    event: string,
    attrs: Record<string, unknown> = {},
    extras: Partial<DeviceEventPayload> = {}
): json_rpc_event {
    return {
        method: `Shelly.Event.${component}.${event}`,
        params: {
            shellyID: 'shellyfixture-front',
            component,
            event,
            attrs,
            schema: null,
            ...extras
        }
    } as unknown as json_rpc_event;
}

describe('onDeviceEvent — subscribe + dispatch', () => {
    it('Fires the subscriber for a matching component+event pair', () => {
        const cb = vi.fn();
        const off = onDeviceEvent('presencezone:0', 'presence', cb);
        try {
            handleDeviceEvent(payload('presencezone:0', 'presence', {v: 1}));
            expect(cb).toHaveBeenCalledTimes(1);
            expect(cb.mock.calls[0][0]).toMatchObject({
                component: 'presencezone:0',
                event: 'presence',
                attrs: {v: 1}
            });
        } finally {
            off();
        }
    });

    it('Does not fire a subscriber for a different event', () => {
        const cb = vi.fn();
        const off = onDeviceEvent('presencezone:0', 'presence', cb);
        try {
            handleDeviceEvent(payload('presencezone:0', 'other'));
            handleDeviceEvent(payload('switch:0', 'presence'));
            expect(cb).not.toHaveBeenCalled();
        } finally {
            off();
        }
    });

    it('Unsubscribe stops further deliveries', () => {
        const cb = vi.fn();
        const off = onDeviceEvent('switch:0', 'toggle', cb);
        handleDeviceEvent(payload('switch:0', 'toggle'));
        off();
        handleDeviceEvent(payload('switch:0', 'toggle'));
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it(
        'Dispatches by structured params, not by method-string parsing — ' +
            'event names containing dots still route correctly',
        () => {
            const cb = vi.fn();
            const off = onDeviceEvent('switch:0', 'power.changed', cb);
            try {
                handleDeviceEvent(
                    payload('switch:0', 'power.changed', {w: 42})
                );
                expect(cb).toHaveBeenCalledTimes(1);
                expect(cb.mock.calls[0][0].event).toBe('power.changed');
            } finally {
                off();
            }
        }
    );

    it('Drops payloads that fail the runtime shape guard', () => {
        const cb = vi.fn();
        const off = onDeviceEvent('switch:0', 'toggle', cb);
        try {
            // Missing component + event → readDeviceEventPayload returns null.
            handleDeviceEvent({
                method: 'Shelly.Event.x.y',
                params: {ts: 1}
            } as unknown as json_rpc_event);
            expect(cb).not.toHaveBeenCalled();
        } finally {
            off();
        }
    });

    it('Multiple subscribers on the same key all fire', () => {
        const a = vi.fn();
        const b = vi.fn();
        const offA = onDeviceEvent('fan:0', 'speed_change', a);
        const offB = onDeviceEvent('fan:0', 'speed_change', b);
        try {
            handleDeviceEvent(payload('fan:0', 'speed_change'));
            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);
        } finally {
            offA();
            offB();
        }
    });
});
