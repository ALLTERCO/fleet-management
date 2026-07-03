import {mount} from '@vue/test-utils';
import {describe, expect, it} from 'vitest';
import MapPinTooltip from '@/components/dashboard/map/MapPinTooltip.vue';
import type {MapPin} from '@/types/map';

const POS = {x: 120, y: 80};

describe('MapPinTooltip', () => {
    it('renders nothing when pin is null', () => {
        const w = mount(MapPinTooltip, {props: {pin: null, position: POS}});
        expect(w.find('.pin-tip').exists()).toBe(false);
    });

    it('shows the pin label and the all-online subtitle for healthy pins', () => {
        const pin: MapPin = {
            id: '1',
            lat: 0,
            lng: 0,
            label: 'HQ',
            status: 'on'
        };
        const w = mount(MapPinTooltip, {props: {pin, position: POS}});
        expect(w.text()).toContain('HQ');
        expect(w.text()).toContain('All devices online');
    });

    it('switches the subtitle to an alert summary when alertCount > 0', () => {
        const pin: MapPin = {
            id: '1',
            lat: 0,
            lng: 0,
            label: 'HQ',
            status: 'warn',
            alertCount: 3
        };
        const w = mount(MapPinTooltip, {props: {pin, position: POS}});
        expect(w.text()).toContain('3 open alerts');
    });

    it('positions the bubble using the supplied screen coords', () => {
        const pin: MapPin = {id: '1', lat: 0, lng: 0, label: 'X'};
        const w = mount(MapPinTooltip, {props: {pin, position: POS}});
        const style = w.get('.pin-tip').attributes('style') ?? '';
        expect(style).toContain('left: 120px');
        expect(style).toContain('top: 80px');
    });

    it('applies a status-tone class to the status pip', () => {
        const pin: MapPin = {
            id: '1',
            lat: 0,
            lng: 0,
            label: 'X',
            status: 'off'
        };
        const w = mount(MapPinTooltip, {props: {pin, position: POS}});
        expect(w.find('.pin-tip__pip--off').exists()).toBe(true);
    });
});
