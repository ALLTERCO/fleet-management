import {flushPromises, mount} from '@vue/test-utils';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The Report templates panel: loads templates, runs one (download), deletes one.

const api = vi.hoisted(() => ({
    listReportTemplates: vi.fn(),
    runReportTemplate: vi.fn(),
    downloadReportFile: vi.fn(),
    deleteReportTemplate: vi.fn(),
    updateReportTemplate: vi.fn()
}));
const consts = vi.hoisted(() => ({
    REPORT_SECTIONS: [
        {id: 'demand', label: 'Demand'},
        {id: 'solar', label: 'Solar'},
        {id: 'battery', label: 'Battery'},
        {id: 'ev', label: 'EV'},
        {id: 'tenant', label: 'Tenant'}
    ]
}));
const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}));

vi.mock('@/api/reportTemplateRpc', () => ({...api, ...consts}));
vi.mock('@/stores/toast', () => ({useToastStore: () => toast}));

import ReportTemplatesPanel from '@/components/reports/ReportTemplatesPanel.vue';

const TEMPLATE = {
    id: 't1',
    name: 'Monthly energy',
    description: null,
    kind: 'energy' as const,
    params: {from: '2026-01-01', to: '2026-01-31'},
    sectionsEnabled: null,
    createdBy: 'u1',
    createdAt: '2026-02-01',
    updatedAt: null
};

beforeEach(() => {
    Object.values(api).forEach((fn) => {
        fn.mockReset();
    });
    toast.success.mockReset();
    toast.error.mockReset();
    api.listReportTemplates.mockResolvedValue({templates: [TEMPLATE]});
});

async function open() {
    const w = mount(ReportTemplatesPanel);
    await flushPromises();
    return w;
}

describe('ReportTemplatesPanel', () => {
    it('lists templates on mount', async () => {
        const w = await open();
        expect(w.text()).toContain('Monthly energy');
    });

    it('runs a template and downloads the resolved file', async () => {
        const ref = {file: 'energy_1.csv', name: 'Monthly energy'};
        api.runReportTemplate.mockResolvedValue(ref);
        const w = await open();
        await w.find('.rt-btn--primary').trigger('click');
        await flushPromises();
        expect(api.runReportTemplate).toHaveBeenCalledWith(
            't1',
            'Monthly energy'
        );
        expect(api.downloadReportFile).toHaveBeenCalledWith(ref);
    });

    it('edits the section allowlist and stores the chosen subset', async () => {
        api.updateReportTemplate.mockResolvedValue({
            ...TEMPLATE,
            sectionsEnabled: ['demand', 'solar', 'battery', 'ev']
        });
        const w = await open();
        const byText = (text: string) =>
            w.findAll('.rt-btn').find((b) => b.text() === text);
        await byText('Sections')!.trigger('click');
        // Deselect the last section (Tenant) → a 4-of-5 subset.
        const boxes = w.findAll('.rt-check input');
        await boxes[boxes.length - 1].trigger('change');
        await byText('Apply')!.trigger('click');
        await flushPromises();
        expect(api.updateReportTemplate).toHaveBeenCalledWith({
            id: 't1',
            sectionsEnabled: ['demand', 'solar', 'battery', 'ev']
        });
    });

    it('deletes a template after confirm', async () => {
        window.confirm = vi.fn(() => true);
        api.deleteReportTemplate.mockResolvedValue({deleted: true});
        const w = await open();
        await w.find('.rt-btn--danger').trigger('click');
        await flushPromises();
        expect(api.deleteReportTemplate).toHaveBeenCalledWith('t1');
        expect(w.text()).not.toContain('Monthly energy');
    });
});
