import assert from 'node:assert/strict';
import test from 'node:test';
import {locationSummaryCountsFromRow} from '../src/modules/location/summaryCounts';

test('omits summary fields the database did not return', () => {
    assert.deepEqual(
        locationSummaryCountsFromRow({
            c_child_locations: '2',
            c_devices: null,
            c_entities: null,
            c_tags: null,
            c_descendant_devices: null,
            c_descendant_entities: null,
            c_groups_referencing: null
        }),
        {childLocations: 2}
    );
});

test('preserves known zero counts instead of treating zero as unavailable', () => {
    assert.deepEqual(
        locationSummaryCountsFromRow({
            c_child_locations: 0,
            c_devices: '0',
            c_descendant_devices: 0
        }),
        {childLocations: 0, devices: 0, descendantDevices: 0}
    );
});

test('omits counts entirely when no summary value is available', () => {
    assert.equal(
        locationSummaryCountsFromRow({
            c_child_locations: null,
            c_devices: undefined,
            c_entities: null
        }),
        undefined
    );
});

test('projects every count that is actually present', () => {
    assert.deepEqual(
        locationSummaryCountsFromRow({
            c_child_locations: '1',
            c_devices: '2',
            c_entities: 3,
            c_tags: '4',
            c_descendant_devices: 5,
            c_descendant_entities: '6',
            c_groups_referencing: 7
        }),
        {
            childLocations: 1,
            devices: 2,
            entities: 3,
            tags: 4,
            descendantDevices: 5,
            descendantEntities: 6,
            groupsReferencingLocation: 7
        }
    );
});
