import {describe, expect, it} from 'vitest';
import {
    firmwareDotFor,
    firmwareProgressStyle,
    firmwareStatusLabel,
    resolveFirmwareCategory
} from '@/helpers/firmwareStatus';

describe('resolveFirmwareCategory — priority order', () => {
    it('returns null when there is no info because we cannot classify', () => {
        expect(resolveFirmwareCategory(null)).toBeNull();
        expect(resolveFirmwareCategory(undefined)).toBeNull();
    });

    it('returns checking when a check is in progress so the spinner overrides everything else', () => {
        expect(
            resolveFirmwareCategory({
                checkStatus: 'checking',
                availableStable: {version: '1.0.0'}
            })
        ).toBe('checking');
    });

    it('prefers stable over beta when both are available so the recommended channel wins', () => {
        expect(
            resolveFirmwareCategory({
                checkStatus: 'checked',
                availableStable: {version: '1.0.0'},
                availableBeta: {version: '1.1.0-beta'}
            })
        ).toBe('stable');
    });

    it('returns beta when only beta is available so beta-only devices still report', () => {
        expect(
            resolveFirmwareCategory({
                checkStatus: 'checked',
                availableBeta: {version: '1.1.0-beta'}
            })
        ).toBe('beta');
    });

    it('returns current when checked succeeded but no update is available', () => {
        expect(resolveFirmwareCategory({checkStatus: 'checked'})).toBe('current');
    });

    it('returns error when the check failed because the user needs to know', () => {
        expect(resolveFirmwareCategory({checkStatus: 'error'})).toBe('error');
    });
});

describe('firmwareDotFor — dot class or null', () => {
    it('returns null for the current category because no dot should render', () => {
        expect(firmwareDotFor({checkStatus: 'checked'})).toBeNull();
    });

    it('returns the stable dot class for an update-available device', () => {
        const dot = firmwareDotFor({
            checkStatus: 'checked',
            availableStable: {version: '1.0.0'}
        });
        expect(dot).toBe('fw-dot--stable');
    });

    it('returns null when info is missing so callers can v-if cleanly', () => {
        expect(firmwareDotFor(null)).toBeNull();
    });
});

describe('firmwareStatusLabel — version-bearing label', () => {
    it('appends the stable version so users see what to expect', () => {
        const label = firmwareStatusLabel({
            checkStatus: 'checked',
            availableStable: {version: '1.0.0'}
        });
        expect(label).toEqual({label: 'Stable 1.0.0'});
    });

    it('appends the beta version when only beta is available', () => {
        const label = firmwareStatusLabel({
            checkStatus: 'checked',
            availableBeta: {version: '1.1.0-beta'}
        });
        expect(label).toEqual({label: 'Beta 1.1.0-beta'});
    });

    it('uses the static label for the current category', () => {
        expect(firmwareStatusLabel({checkStatus: 'checked'})).toEqual({
            label: 'Up to date'
        });
    });

    it('returns null when info is missing', () => {
        expect(firmwareStatusLabel(undefined)).toBeNull();
    });

    it('falls back to the static label when the version is missing on stable', () => {
        const label = firmwareStatusLabel({
            checkStatus: 'checked',
            availableStable: {}
        });
        expect(label).toEqual({label: 'Stable'});
    });
});

describe('firmwareProgressStyle — phase → bar style', () => {
    it('uses the live percent when the phase leaves width null so downloading bars animate', () => {
        const style = firmwareProgressStyle({phase: 'downloading', percent: 42});
        expect(style.width).toBe('42%');
        expect(style.backgroundColor).toBe('var(--color-primary)');
    });

    it('locks the bar at the phase-specified width when one is set so reboot does not wobble with stale percent', () => {
        const style = firmwareProgressStyle({phase: 'rebooting', percent: 17});
        expect(style.width).toBe('100%');
        expect(style.backgroundColor).toBe('var(--color-warning)');
    });

    it('marks failure with the danger color so the bar visibly signals broken state', () => {
        const style = firmwareProgressStyle({phase: 'failed', percent: 99});
        expect(style.backgroundColor).toBe('var(--color-danger)');
    });

    it('falls back to the idle style for an unknown phase string so a typo never blows up the row', () => {
        const style = firmwareProgressStyle({
            phase: 'fictional-phase',
            percent: 50
        });
        expect(style.width).toBe('0%');
        expect(style.backgroundColor).toBe('var(--color-surface-4)');
    });
});
