import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {floats} from '../src/config/shelly.dataTypes';

describe('floatFieldMap — O(1) field→group lookup', () => {
    // Replicate the Map construction from ShellyMessageHandler.ts
    const floatFieldMap = new Map<string, string>();
    for (let i = 0; i < floats.raw.length; i++) {
        floatFieldMap.set(floats.raw[i], floats.group[i]);
    }

    it('should have same size as floats.raw', () => {
        assert.equal(floatFieldMap.size, new Set(floats.raw).size);
    });

    it('should map every float field to its group', () => {
        for (let i = 0; i < floats.raw.length; i++) {
            const field = floats.raw[i];
            const group = floats.group[i];
            assert.equal(
                floatFieldMap.get(field),
                group,
                `field "${field}" should map to group "${group}"`
            );
        }
    });

    it('should return undefined for unknown fields', () => {
        assert.equal(floatFieldMap.get('nonexistent.field'), undefined);
        assert.equal(floatFieldMap.get(''), undefined);
    });

    it('should contain known energy fields', () => {
        assert.ok(floatFieldMap.has('switch:0.aenergy.total'));
        assert.ok(floatFieldMap.has('em:0.voltage'));
        assert.ok(floatFieldMap.has('temperature:0.tC'));
    });

    it('should have wildcard groups for indexed fields', () => {
        // switch:0 → switch:*
        const group = floatFieldMap.get('switch:0.aenergy.total');
        assert.ok(
            group?.includes('*'),
            `group "${group}" should contain wildcard`
        );
    });
});
