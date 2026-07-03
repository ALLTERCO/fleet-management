import {mount} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick} from 'vue';
import LocationFocusCard from '@/components/locations/LocationFocusCard.vue';
import type {LocationKpiSnapshot} from '@/types/focusCard';

const kpis: LocationKpiSnapshot = Object.freeze({
    total: 148,
    on: 142,
    off: 3,
    warn: 3,
    powerKW: 2.7,
    todayKWh: 12.4,
    alerts: 3,
    lastSeenTs: Date.now() - 32_000,
    savingsPotentialPct: 25,
    firmwareHealthPct: 87,
    signalHealthPct: 91
});

const props = {
    visible: true,
    site: {
        id: 7,
        name: 'Berlin HQ',
        city: 'Berlin, Germany',
        lat: 52.52,
        lng: 13.41,
        status: 'warn' as const
    },
    kpis,
    position: {left: 100, top: 100},
    snoozeAvailable: true
};

function mountCard(overrides: Partial<typeof props> = {}) {
    return mount(LocationFocusCard, {
        props: {...props, ...overrides},
        attachTo: document.body
    });
}

describe('LocationFocusCard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders the site name in the hero', () => {
        const w = mountCard();
        expect(w.find('.lfc__site-name').text()).toBe('Berlin HQ');
        w.unmount();
    });

    it('renders all 8 KPI tiles with correct values', () => {
        const w = mountCard();
        const tiles = w.findAll('.kti');
        expect(tiles).toHaveLength(8);

        const values = tiles.map((t) => t.find('.kti__value').text());
        // Row 1: Devices, Load, Today, Alerts
        expect(values[0]).toBe('148');
        expect(values[1]).toContain('2.7');
        expect(values[2]).toContain('12.4');
        expect(values[3]).toBe('3');
        // Row 2: Last seen, Savings, Firmware, Signal
        expect(values[4]).toBe('32s ago');
        expect(values[5]).toContain('25');
        expect(values[6]).toContain('87');
        expect(values[7]).toContain('91');
        w.unmount();
    });

    it('emits openSite when Open site button is clicked', async () => {
        const w = mountCard();
        await w.find('[data-testid="fc-open-site"]').trigger('click');
        expect(w.emitted('openSite')).toHaveLength(1);
        w.unmount();
    });

    it('emits openFloorPlan when Floor plan button is clicked', async () => {
        const w = mountCard();
        await w.find('[data-testid="fc-floor-plan"]').trigger('click');
        expect(w.emitted('openFloorPlan')).toHaveLength(1);
        w.unmount();
    });

    it('emits snooze when Snooze alerts button is clicked', async () => {
        const w = mountCard();
        await w.find('[data-testid="fc-snooze"]').trigger('click');
        expect(w.emitted('snooze')).toHaveLength(1);
        w.unmount();
    });

    it('emits close when Close button is clicked', async () => {
        const w = mountCard();
        await w.find('[data-testid="fc-close"]').trigger('click');
        expect(w.emitted('close')).toHaveLength(1);
        w.unmount();
    });

    it('does NOT render an Expand button — focus card is single-size by design', () => {
        const w = mountCard();
        expect(w.find('[data-testid="fc-expand"]').exists()).toBe(false);
        w.unmount();
    });

    it('applies position prop as inline left/top style', () => {
        const w = mountCard();
        const style = w.find('article').attributes('style') ?? '';
        expect(style).toContain('left: 100px');
        expect(style).toContain('top: 100px');
        w.unmount();
    });

    it('has lfc--visible class when visible is true', () => {
        const w = mountCard({visible: true});
        expect(w.find('article').classes()).toContain('lfc--visible');
        w.unmount();
    });

    it('does not have lfc--visible class when visible is false', () => {
        const w = mountCard({visible: false});
        expect(w.find('article').classes()).not.toContain('lfc--visible');
        w.unmount();
    });

    it('disables Snooze button when snoozePending is true', () => {
        const w = mountCard({snoozePending: true});
        const btn = w.find<HTMLButtonElement>('[data-testid="fc-snooze"]');
        expect((btn.element as HTMLButtonElement).disabled).toBe(true);
        w.unmount();
    });

    it('omits the Snooze button when snoozeAvailable is false', () => {
        const w = mountCard({snoozeAvailable: false});
        expect(w.find('[data-testid="fc-snooze"]').exists()).toBe(false);
        w.unmount();
    });

    it('moves focus to Close button when visible changes from false to true', async () => {
        const w = mountCard({visible: false});
        await w.setProps({visible: true});
        await nextTick();
        await nextTick();
        const closeEl = w.find('[data-testid="fc-close"]').element;
        expect(document.activeElement).toBe(closeEl);
        w.unmount();
    });

    it('shows the "Live updates unavailable" badge when liveFallback is snapshot', () => {
        const w = mount(LocationFocusCard, {
            props: {...props, liveFallback: 'snapshot'}
        });
        expect(w.text()).toContain('Live updates unavailable');
        w.unmount();
    });

    it('shows "No access" badge when liveFallback is forbidden', () => {
        const w = mount(LocationFocusCard, {
            props: {...props, liveFallback: 'forbidden'}
        });
        expect(w.text()).toContain('No access');
        w.unmount();
    });

    it('does NOT show the badge when liveFallback is live', () => {
        const w = mount(LocationFocusCard, {
            props: {...props, liveFallback: 'live'}
        });
        expect(w.text()).not.toContain('Live updates unavailable');
        expect(w.text()).not.toContain('No access');
        w.unmount();
    });
});
