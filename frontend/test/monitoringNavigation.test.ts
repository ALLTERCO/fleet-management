import {describe, expect, it} from 'vitest';
import {MONITORING_TABS} from '@/helpers/monitoringNavigation';

describe('monitoring navigation contract', () => {
    it('keeps monitoring at five top-level operator tabs', () => {
        expect(MONITORING_TABS.map((tab) => tab.label)).toEqual([
            'Overview',
            'Runtime',
            'Resources',
            'Activity',
            'Investigate'
        ]);
        expect(MONITORING_TABS.map((tab) => tab.path)).toEqual([
            '/monitoring/overview',
            '/monitoring/runtime',
            '/monitoring/resources',
            '/monitoring/activity',
            '/monitoring/investigate'
        ]);
    });

    it('keeps each top-level tab backed by an icon for scanability', () => {
        expect(MONITORING_TABS).toHaveLength(5);
        for (const tab of MONITORING_TABS) {
            expect(tab.icon).toMatch(/^fas fa-/);
        }
    });
});
