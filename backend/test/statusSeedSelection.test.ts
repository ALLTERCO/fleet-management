// Must come before anything that reaches src/config/runtimeMetadata, which throws on load
// when its required variables are absent. Import order is the mechanism.
import './helpers/env';

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {selectSeedFields} from '../src/modules/ShellyMessageHandler';

/**
 * Which fields a status message really needs a database seed for (issue #29).
 *
 * `device.fn_status_last_values` is documented as a boot-time cold start, but it ran
 * continuously and cost roughly a full core of database time at ~600 ms per call. The reason is
 * here rather than in the query: the seed set was built from every field the message carried,
 * while the previous values it was checked against come from the diff — and the merge only
 * emits a diff entry when the value actually changed. Every unchanged field therefore looked
 * like a field with no known previous value, so a steady meter asked for a seed on nearly every
 * message, and the quieter the fleet the more of them there were.
 *
 * An unchanged field's previous value is the value in the message itself, which is precisely
 * what the database would have returned.
 */

const group = 'switch:0.apower';
const other = 'switch:0.voltage';

describe('cold-start seed selection', () => {
    it('does not seed a field the message carries but the diff never mentioned', () => {
        const perField = new Map<string, unknown>();
        const needed = selectSeedFields({[group]: 12.5}, [], perField);

        assert.deepEqual(needed, []);
        // Resolved locally to exactly what the seed would have returned.
        assert.equal(perField.get(group), 12.5);
    });

    it('seeds a field whose change reports no previous value, which is the real cold start', () => {
        const perField = new Map<string, unknown>([[group, undefined]]);
        const needed = selectSeedFields({[group]: 12.5}, [{path: group}], perField);

        assert.deepEqual(needed, [group]);
    });

    it('does not seed a field whose previous value the diff already carried', () => {
        const perField = new Map<string, unknown>([[group, 11]]);
        const needed = selectSeedFields({[group]: 12.5}, [{path: group}], perField);

        assert.deepEqual(needed, []);
        assert.equal(perField.get(group), 11);
    });

    it('separates the two in one message, which is the ordinary steady-state shape', () => {
        // One field moved and has no history yet; the rest of the message is unchanged.
        const perField = new Map<string, unknown>();
        const needed = selectSeedFields(
            {[group]: 12.5, [other]: 230.1},
            [{path: group}],
            perField
        );

        assert.deepEqual(needed, [group]);
        assert.equal(perField.get(other), 230.1);
        assert.equal(perField.has(group), false);
    });

    it('leaves a non-finite unchanged reading alone rather than recording it as a previous value', () => {
        // Errored meter channels report null. The flush already skips those; recording one here
        // would put a value into the previous-value map that the flush would never write.
        const perField = new Map<string, unknown>();
        const needed = selectSeedFields({[group]: null}, [], perField);

        assert.deepEqual(needed, []);
        assert.equal(perField.has(group), false);
    });

    it('ignores fields the flush does not care about', () => {
        const perField = new Map<string, unknown>();
        const needed = selectSeedFields({'sys.uptime_not_a_status_field': 1}, [], perField);

        assert.deepEqual(needed, []);
        assert.equal(perField.size, 0);
    });
});
