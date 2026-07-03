// One purpose per test — describes the validation rule, not the function.

import {describe, expect, it} from 'vitest';
import {
    buildWidgetPayload,
    type WidgetConfigBundle
} from '@/helpers/widgetBuilders';

function makeCfgs(
    overrides: Partial<WidgetConfigBundle> = {}
): WidgetConfigBundle {
    return {
        chartCfg: {shellyId: '', metric: 'power', chartType: 'bar'},
        gaugeCfg: {
            entityId: '',
            field: '',
            label: '',
            unit: '',
            min: 0,
            max: 100
        },
        statsCfg: {shellyId: '', metric: 'temperature', name: ''},
        topCfg: {entityIdsRaw: '', limit: 10},
        timelineCfg: {shellyId: '', field: '', name: ''},
        heatmapCfg: {shellyId: '', metric: 'temperature'},
        siteGridCfg: {metric: 'power'},
        maintCfg: {maxItems: 20},
        crossBarCfg: {metric: 'live_power', limit: 10},
        ...overrides
    };
}

describe('chart widget — needs a device id', () => {
    it('rejects when shellyId is empty so the chart has something to render', () => {
        const r = buildWidgetPayload('chart_widget', makeCfgs());
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message).toContain('device');
    });

    it('returns the canonical chart shape when configured', () => {
        const r = buildWidgetPayload(
            'chart_widget',
            makeCfgs({
                chartCfg: {shellyId: 'abc', metric: 'power', chartType: 'bar'}
            })
        );
        expect(r.ok).toBe(true);
        if (r.ok)
            expect(r.data).toEqual({
                id: 'chart_widget',
                shellyId: 'abc',
                metric: 'power',
                chartType: 'bar'
            });
    });
});

describe('gauge widget — needs entity + field', () => {
    it('rejects when entityId is empty because the gauge has nothing to read', () => {
        const r = buildWidgetPayload(
            'gauge_widget',
            makeCfgs({
                gaugeCfg: {
                    entityId: '',
                    field: 'x',
                    label: '',
                    unit: '',
                    min: 0,
                    max: 100
                }
            })
        );
        expect(r.ok).toBe(false);
    });

    it('falls back label → field when label is empty so the gauge always has a title', () => {
        const r = buildWidgetPayload(
            'gauge_widget',
            makeCfgs({
                gaugeCfg: {
                    entityId: 'e',
                    field: 'temp',
                    label: '',
                    unit: '°C',
                    min: 0,
                    max: 100
                }
            })
        );
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.label).toBe('temp');
    });
});

describe('top consumers — needs at least one entity id', () => {
    it('rejects empty raw list so the widget never renders 0 rows', () => {
        const r = buildWidgetPayload('top_consumers_widget', makeCfgs());
        expect(r.ok).toBe(false);
    });

    it('splits comma-separated ids and trims whitespace because users paste lists', () => {
        const r = buildWidgetPayload(
            'top_consumers_widget',
            makeCfgs({topCfg: {entityIdsRaw: 'a , b ,  c', limit: 3}})
        );
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.entityIds).toEqual(['a', 'b', 'c']);
    });
});

describe('configless widgets — emit fixed payloads', () => {
    it('returns a sensible default for energy_flow_sankey_widget', () => {
        const r = buildWidgetPayload('energy_flow_sankey_widget', makeCfgs());
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.id).toBe('energy_flow_sankey_widget');
    });

    it('returns the bare id for an unknown widget type so the modal still functions', () => {
        const r = buildWidgetPayload(
            'unknown_widget' as unknown as Parameters<
                typeof buildWidgetPayload
            >[0],
            makeCfgs()
        );
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.data.id).toBe('unknown_widget');
    });
});

describe('JSON-size guard — backend column cap', () => {
    it('rejects a chart payload whose shellyId is enormous', () => {
        const r = buildWidgetPayload(
            'chart_widget',
            makeCfgs({
                chartCfg: {
                    shellyId: 'X'.repeat(500),
                    metric: 'power',
                    chartType: 'bar'
                }
            })
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message).toContain('long');
    });
});
