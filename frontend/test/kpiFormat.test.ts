import {describe, expect, it} from 'vitest';
import {
    formatKpiValue,
    kpiDeltaDirection,
    kpiSeverity,
    sparkStrokeFor
} from '@/helpers/kpiFormat';
import type {DashKpiMetric} from '@/types/dashboard-components';

function metric(overrides: Partial<DashKpiMetric>): DashKpiMetric {
    return {
        key: overrides.key ?? 'k',
        label: overrides.label ?? 'Label',
        value: overrides.value ?? 0,
        ...overrides
    };
}

describe('formatKpiValue', () => {
    it('returns the em-dash for null values', () => {
        expect(formatKpiValue(metric({value: null}))).toBe('—');
    });

    it('returns string values verbatim', () => {
        expect(formatKpiValue(metric({value: 'OK'}))).toBe('OK');
    });

    it('uses the supplied decimal precision', () => {
        expect(formatKpiValue(metric({value: 12.345, decimals: 2}))).toBe(
            '12.35'
        );
    });

    it('defaults to one decimal place when none is given', () => {
        expect(formatKpiValue(metric({value: 1.25}))).toBe('1.3');
    });
});

describe('kpiDeltaDirection', () => {
    it('reads + or up-arrow as up', () => {
        expect(kpiDeltaDirection('+5%')).toBe('up');
        expect(kpiDeltaDirection('↑3')).toBe('up');
    });

    it('reads - or down-arrow as down', () => {
        expect(kpiDeltaDirection('-5%')).toBe('down');
        expect(kpiDeltaDirection('↓3')).toBe('down');
    });

    it('treats anything else as flat', () => {
        expect(kpiDeltaDirection('0%')).toBe('flat');
        expect(kpiDeltaDirection(null)).toBe('flat');
        expect(kpiDeltaDirection(undefined)).toBe('flat');
        expect(kpiDeltaDirection('')).toBe('flat');
    });
});

describe('kpiSeverity', () => {
    it('returns normal when no threshold is set', () => {
        expect(kpiSeverity(metric({value: 999}))).toBe('normal');
    });

    it('returns normal when value is a string', () => {
        expect(
            kpiSeverity(
                metric({value: 'OK', threshold: {warning: 10, danger: 20}})
            )
        ).toBe('normal');
    });

    it('returns warning at or above warning threshold', () => {
        expect(
            kpiSeverity(
                metric({value: 10, threshold: {warning: 10, danger: 20}})
            )
        ).toBe('warning');
    });

    it('returns danger at or above danger threshold', () => {
        expect(
            kpiSeverity(
                metric({value: 25, threshold: {warning: 10, danger: 20}})
            )
        ).toBe('danger');
    });

    it('handles inverted thresholds (warning > danger) by ignoring warning', () => {
        // Caller bug — config says danger=50, warning=100. Treat danger alone.
        expect(
            kpiSeverity(
                metric({value: 70, threshold: {warning: 100, danger: 50}})
            )
        ).toBe('danger');
        expect(
            kpiSeverity(
                metric({value: 40, threshold: {warning: 100, danger: 50}})
            )
        ).toBe('normal');
    });
});

describe('sparkStrokeFor', () => {
    it('maps severity to the matching CSS variable', () => {
        expect(sparkStrokeFor('normal')).toContain('--sparkline-stroke');
        expect(sparkStrokeFor('warning')).toContain('warning');
        expect(sparkStrokeFor('danger')).toContain('danger');
    });
});
