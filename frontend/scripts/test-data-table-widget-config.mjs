import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    buildWidgetPayload,
    createWidgetCfgBundle,
    seedCfgBundleFromConfig
} from '../src/helpers/widgetBuilders.ts';

test('new Device Health tables keep the existing defaults', () => {
    const bundle = createWidgetCfgBundle();
    const built = buildWidgetPayload('data_table_widget', bundle);

    assert.deepEqual(built, {
        ok: true,
        data: {
            id: 'data_table_widget',
            source: 'device_health',
            sortBy: 'name',
            maxRows: 100
        }
    });
});

test('creation serializes a user-selected sort and row limit', () => {
    const bundle = createWidgetCfgBundle();
    bundle.dataTableCfg.sortBy = 'signal';
    bundle.dataTableCfg.maxRows = 16;

    const built = buildWidgetPayload('data_table_widget', bundle);
    assert.equal(built.ok, true);
    assert.deepEqual(built.ok ? built.data : null, {
        id: 'data_table_widget',
        source: 'device_health',
        sortBy: 'signal',
        maxRows: 16
    });
});

test('edit seeding round-trips an existing Device Health table config', () => {
    const bundle = createWidgetCfgBundle();
    seedCfgBundleFromConfig(bundle, {
        id: 'data_table_widget',
        source: 'device_health',
        sortBy: 'battery',
        maxRows: 24
    });

    assert.deepEqual(bundle.dataTableCfg, {sortBy: 'battery', maxRows: 24});
    const rebuilt = buildWidgetPayload('data_table_widget', bundle);
    assert.deepEqual(rebuilt.ok ? rebuilt.data : null, {
        id: 'data_table_widget',
        source: 'device_health',
        sortBy: 'battery',
        maxRows: 24
    });
});

test('invalid stored values fall back and invalid edits cannot serialize', () => {
    const bundle = createWidgetCfgBundle();
    seedCfgBundleFromConfig(bundle, {
        id: 'data_table_widget',
        sortBy: 'unsupported',
        maxRows: 0
    });
    assert.deepEqual(bundle.dataTableCfg, {sortBy: 'name', maxRows: 100});

    bundle.dataTableCfg.maxRows = 1.5;
    assert.deepEqual(buildWidgetPayload('data_table_widget', bundle), {
        ok: false,
        message: 'Max rows must be a positive whole number'
    });
});
