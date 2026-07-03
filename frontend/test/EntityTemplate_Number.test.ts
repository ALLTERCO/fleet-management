import {mount} from '@vue/test-utils';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/stores/auth', () => ({
    useAuthStore: () => ({
        canWrite: true,
        isReadOnly: false,
        isAdmin: true,
        isViewer: false,
        permissionsLoaded: true
    })
}));

import EntityTemplate_Number from '@/components/entity-templates/EntityTemplate_Number.vue';

function mountTemplate(props: Partial<Record<string, unknown>>) {
    return mount(EntityTemplate_Number, {
        props: {
            status: {value: 42},
            settings: {},
            canExecute: true,
            ...props
        },
        global: {
            stubs: {
                HorizontalSlider: {
                    name: 'HorizontalSlider',
                    props: ['value', 'min', 'max', 'step', 'disabled'],
                    template: '<div data-stub="slider" :data-value="value" />'
                }
            }
        }
    });
}

describe('EntityTemplate_Number — value + unit always render', () => {
    it('always shows the current value and unit at the top of the card', () => {
        const w = mountTemplate({unit: '°C'});
        expect(w.text()).toContain('42');
        expect(w.text()).toContain('°C');
    });

    it('falls back to N/A when status.value is missing — never renders undefined', () => {
        const w = mountTemplate({status: undefined, unit: '°C'});
        expect(w.text()).toContain('N/A');
    });
});

describe('EntityTemplate_Number — bounded range exposes a meta line', () => {
    it('prints min – max + unit when both bounds are set so the user sees the limits', () => {
        const w = mountTemplate({min: 10, max: 30, unit: '°C'});
        const meta = w.find('.et-num__meta');
        expect(meta.exists()).toBe(true);
        expect(meta.text()).toContain('10');
        expect(meta.text()).toContain('30');
        expect(meta.text()).toContain('°C');
    });

    it('adds a step indicator when step is non-default so non-integer increments are obvious', () => {
        const w = mountTemplate({min: 0, max: 1, step: 0.1});
        expect(w.text()).toContain('step 0.1');
    });

    it('hides the meta line entirely when min/max are absent — no fake 0-100 placeholder', () => {
        const w = mountTemplate({});
        expect(w.find('.et-num__meta').exists()).toBe(false);
    });
});

describe('EntityTemplate_Number — auto-picks the right view when no view prop is passed', () => {
    it('renders a slider by default when bounded and writable so the user can drag', () => {
        const w = mountTemplate({min: 0, max: 100, canExecute: true});
        expect(w.find('[data-stub="slider"]').exists()).toBe(true);
    });

    it('renders a progress bar by default when bounded and read-only — no editing UI for viewers', () => {
        const w = mountTemplate({min: 0, max: 100, canExecute: false});
        expect(w.find('.et-num__progress').exists()).toBe(true);
        expect(w.find('[data-stub="slider"]').exists()).toBe(false);
    });

    it('falls back to a numeric field when bounds are unknown but the user can write — open-range edit', () => {
        const w = mountTemplate({canExecute: true});
        expect(w.find('input[type="number"]').exists()).toBe(true);
        expect(w.find('[data-stub="slider"]').exists()).toBe(false);
    });

    it('respects an explicit view prop — caller override beats auto-pick', () => {
        const w = mountTemplate({
            min: 0,
            max: 100,
            canExecute: true,
            view: 'field'
        });
        expect(w.find('input[type="number"]').exists()).toBe(true);
        expect(w.find('[data-stub="slider"]').exists()).toBe(false);
    });
});

describe('EntityTemplate_Number — progress bar percent clamps to the bounded range', () => {
    it('maps the current value to 0-100 within the bounded range, not raw value', () => {
        const w = mountTemplate({
            status: {value: 25},
            min: 0,
            max: 50,
            canExecute: false
        });
        const fill = w.find('.et-num__progress-fill');
        expect(fill.attributes('style')).toContain('width: 50%');
    });
});
