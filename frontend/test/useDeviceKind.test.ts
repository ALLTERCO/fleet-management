import {describe, expect, it} from 'vitest';
import {ref} from 'vue';
import {classifyExternalId, useDeviceKind} from '@/composables/useDeviceKind';

describe('classifyExternalId — externalId prefix is the single source of truth for kind', () => {
    it('treats vdev_-prefixed ids as composed virtual devices — backend mints this prefix on Create', () => {
        expect(classifyExternalId('vdev_fireplace_42')).toBe('composed');
    });

    it('treats blu_-prefixed ids as bluetooth child devices, distinct from physical and virtual', () => {
        expect(classifyExternalId('blu_aabbccddeeff')).toBe('bluetooth');
    });

    it('treats everything else as physical — Shelly device IDs do not use those prefixes', () => {
        expect(classifyExternalId('shellyplus2pm-aabbccdd')).toBe('physical');
        expect(classifyExternalId('shellypro4pm-f008d1d8b8b8')).toBe(
            'physical'
        );
    });

    it('defaults to physical when the externalId is missing so legacy devices keep working', () => {
        expect(classifyExternalId(undefined)).toBe('physical');
        expect(classifyExternalId(null)).toBe('physical');
        expect(classifyExternalId('')).toBe('physical');
    });
});

describe('useDeviceKind — exposes mutually-meaningful flags for the device detail page', () => {
    it('marks a Shelly device as physical, neither bluetooth nor virtual', () => {
        const {isPhysical, isBluetooth, isVirtual} = useDeviceKind(
            'shellyplus2pm-aabbccdd'
        );
        expect(isPhysical.value).toBe(true);
        expect(isBluetooth.value).toBe(false);
        expect(isVirtual.value).toBe(false);
    });

    it('marks a vdev_ device as virtual but not bluetooth or physical', () => {
        const {isPhysical, isBluetooth, isVirtual} =
            useDeviceKind('vdev_fireplace_42');
        expect(isPhysical.value).toBe(false);
        expect(isBluetooth.value).toBe(false);
        expect(isVirtual.value).toBe(true);
    });

    it('marks a blu_ device as bluetooth only — bluetooth is its own category, not a flavour of virtual', () => {
        const {isPhysical, isBluetooth, isVirtual} =
            useDeviceKind('blu_aabbccddeeff');
        expect(isPhysical.value).toBe(false);
        expect(isBluetooth.value).toBe(true);
        expect(isVirtual.value).toBe(false);
    });
});

describe('useDeviceKind — showsPhysicalPanels gates physical-only UI', () => {
    it('returns true for physical Shelly devices so Web GUI + Network panels render', () => {
        const {showsPhysicalPanels} = useDeviceKind('shellyplus2pm-aabbccdd');
        expect(showsPhysicalPanels.value).toBe(true);
    });

    it('returns true for bluetooth children — they have real hardware behind a gateway', () => {
        const {showsPhysicalPanels} = useDeviceKind('blu_aabbccddeeff');
        expect(showsPhysicalPanels.value).toBe(true);
    });

    it('returns false for virtual devices so Web GUI, profile-switch and firmware panels disappear', () => {
        const {showsPhysicalPanels} = useDeviceKind('vdev_fireplace_42');
        expect(showsPhysicalPanels.value).toBe(false);
    });
});

describe('useDeviceKind — reacts to externalId changing under the composable', () => {
    it('re-derives kind when the underlying ref changes — useful for tab-switching between devices', () => {
        const id = ref<string>('shellyplus2pm-aabbccdd');
        const {kind, isVirtual} = useDeviceKind(id);
        expect(kind.value).toBe('physical');
        expect(isVirtual.value).toBe(false);
        id.value = 'vdev_fireplace_42';
        expect(kind.value).toBe('composed');
        expect(isVirtual.value).toBe(true);
    });
});
