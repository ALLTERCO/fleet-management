import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {flattie} from 'flattie';
import {floats} from '../src/config/shelly.dataTypes';

describe('status batch processing logic', () => {
    // Replicate the Map construction
    const floatFieldMap = new Map<string, string>();
    for (let i = 0; i < floats.raw.length; i++) {
        floatFieldMap.set(floats.raw[i], floats.group[i]);
    }

    it('should correctly flatten and match fields from a device status', () => {
        // Simulate a real NotifyStatus params object
        const params = {
            ts: 1708200000,
            'switch:0': {
                aenergy: {total: 42.5, minute_ts: 1708200000},
                voltage: 230.1,
                current: 0.5,
                apower: 115.0
            }
        };

        const {ts, ...components} = params;
        const d = flattie(components);

        // Collect matched fields
        const matched: {field: string; group: string; value: any}[] = [];
        for (const k of Object.keys(d)) {
            const group = floatFieldMap.get(k);
            if (group !== undefined) {
                matched.push({field: k, group, value: d[k]});
            }
        }

        // Verify known fields were matched
        const matchedFields = matched.map((m) => m.field);
        assert.ok(matchedFields.includes('switch:0.aenergy.total'));
        assert.ok(matchedFields.includes('switch:0.voltage'));
        assert.ok(matchedFields.includes('switch:0.current'));
        assert.ok(matchedFields.includes('switch:0.apower'));

        // Verify values are correct
        const totalEntry = matched.find(
            (m) => m.field === 'switch:0.aenergy.total'
        );
        assert.equal(totalEntry?.value, 42.5);

        // Verify groups contain wildcards
        for (const m of matched) {
            assert.ok(
                m.group.includes('*'),
                `group "${m.group}" for field "${m.field}" should contain wildcard`
            );
        }
    });

    it('should not match non-float fields', () => {
        const params = {
            ts: 1708200000,
            'switch:0': {
                output: true,
                source: 'button'
            }
        };

        const {ts, ...components} = params;
        const d = flattie(components);

        let matchCount = 0;
        for (const k of Object.keys(d)) {
            if (floatFieldMap.has(k)) {
                matchCount++;
            }
        }

        assert.equal(matchCount, 0, 'boolean/string fields should not match');
    });

    it('should handle empty params', () => {
        const params = {ts: 1708200000};
        const {ts, ...components} = params;
        const d = flattie(components);
        assert.equal(Object.keys(d).length, 0);
    });

    it('should build correct flush queue entries', () => {
        const deviceId = 42;
        const ts = 1708200000;
        const params = {
            ts,
            'temperature:0': {tC: 25.5, tF: 77.9}
        };

        const {ts: _ts, ...components} = params;
        const d = flattie(components);

        // Simulate flush queue building
        const queue = {
            p_ts: [] as string[],
            p_id: [] as number[],
            p_field: [] as string[],
            p_field_group: [] as string[],
            p_value: [] as number[],
            p_prev_value: [] as number[]
        };

        for (const k of Object.keys(d)) {
            const group = floatFieldMap.get(k);
            if (group === undefined) continue;
            const v = d[k];
            queue.p_ts.push(ts.toFixed(0));
            queue.p_id.push(deviceId);
            queue.p_field.push(k);
            queue.p_field_group.push(group);
            queue.p_value.push(v);
            queue.p_prev_value.push(v); // first push: prev = current
        }

        // Should have entries for tC and tF
        assert.equal(queue.p_ts.length, 2);
        assert.ok(queue.p_field.includes('temperature:0.tC'));
        assert.ok(queue.p_field.includes('temperature:0.tF'));
        assert.equal(queue.p_id[0], 42);
        assert.equal(queue.p_id[1], 42);
    });

    it('should handle multiple devices in a batch', () => {
        const batch = [
            {ts: 100, deviceId: 1, params: {ts: 100, 'em:0': {voltage: 230}}},
            {ts: 101, deviceId: 2, params: {ts: 101, 'em:0': {voltage: 231}}},
            {ts: 102, deviceId: 3, params: {ts: 102, 'em:0': {voltage: 229}}}
        ];

        const queue = {
            p_ts: [] as string[],
            p_id: [] as number[],
            p_field: [] as string[],
            p_value: [] as number[]
        };

        for (const msg of batch) {
            const {ts, ...components} = msg.params;
            const d = flattie(components);
            for (const k of Object.keys(d)) {
                const group = floatFieldMap.get(k);
                if (group === undefined) continue;
                queue.p_ts.push(ts.toFixed(0));
                queue.p_id.push(msg.deviceId);
                queue.p_field.push(k);
                queue.p_value.push(d[k]);
            }
        }

        assert.equal(queue.p_id.length, 3);
        assert.deepEqual(queue.p_id, [1, 2, 3]);
        assert.deepEqual(queue.p_value, [230, 231, 229]);
    });
});
