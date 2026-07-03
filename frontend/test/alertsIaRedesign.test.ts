// IA redesign Steps 1-3 + 5 — structural assertions on the touched files.

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

function read(rel: string): string {
    return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}

describe('IA redesign — outer Alerts tabs (Step 2)', () => {
    const src = read('src/pages/alerts.vue');

    it('labels the channels tab "Channels", not "Notifications"', () => {
        expect(src).toMatch(
            /label:\s*'Channels',\s*path:\s*'\/alerts\/channels'/
        );
        expect(src).not.toMatch(
            /label:\s*'Notifications',\s*path:\s*'\/alerts\/channels'/
        );
    });
});

describe('IA redesign — /alerts/channels page (Steps 1, 2, 5)', () => {
    const src = read('src/pages/alerts/channels/index.vue');

    it('no longer imports ViewToggle', () => {
        expect(src).not.toMatch(/from '@\/components\/core\/ViewToggle\.vue'/);
    });

    it('no longer has a mode toggle slot or mode ref', () => {
        expect(src).not.toMatch(/<ViewToggle\b/);
        expect(src).not.toMatch(/const mode = ref</);
        expect(src).not.toMatch(/function setMode\b/);
    });

    it('drops the routing / on-call / history mode sections', () => {
        expect(src).not.toMatch(/mode === 'routing'/);
        expect(src).not.toMatch(/mode === 'oncall'/);
        expect(src).not.toMatch(/mode === 'history'/);
    });

    it('renders the page with the "Channels" title', () => {
        expect(src).toMatch(/title="Channels"/);
        expect(src).not.toMatch(/title="Notifications"/);
    });

    it('drops the Bundles import/export overlay — channels are managed inline', () => {
        expect(src).not.toMatch(/showBundles/);
        expect(src).not.toMatch(/Import \/ export/);
    });

    it('drops the "My preferences" overlay because the button just took up header space', () => {
        expect(src).not.toMatch(/My preferences/);
        expect(src).not.toMatch(/showPreferences/);
    });
});

describe('IA redesign — Rules editor wizard', () => {
    const src = read('src/components/modals/EditAlertRuleModal.vue');

    it('keeps the When → Applies to → Notify labels', () => {
        expect(src).toMatch(/label: 'When'/);
        expect(src).toMatch(/label: 'Applies to'/);
        expect(src).toMatch(/label: 'Notify'/);
    });

    it('labels the recipients section "Who to notify", not "Destinations"', () => {
        expect(src).toMatch(/>Who to notify</);
        expect(src).not.toMatch(/>Destinations</);
    });

    it('folds one-device setup into When and shows Applies to only for wider scope', () => {
        expect(src).toMatch(/const visibleStepIds = computed<number\[\]>\(\(\) =>\s*showAppliesToStep\.value \? \[1, 2, 3\] : \[1, 3\]/);
        expect(src).toMatch(/const showAppliesToStep = computed/);
        expect(src).toMatch(/function chooseManyScope\(\)/);
        expect(src).toMatch(/step\.value = isSingleScope\(formScope\.value\) \? 3 : 1/);
    });
});

describe('IA redesign — On-call store still exports its RPCs (Step 5)', () => {
    const src = read('src/stores/notifications.ts');

    it('still exposes fetchOnCallSchedules / saveOnCallSchedule / deleteOnCallSchedule', () => {
        expect(src).toMatch(/async function fetchOnCallSchedules\b/);
        expect(src).toMatch(/async function saveOnCallSchedule\b/);
        expect(src).toMatch(/async function deleteOnCallSchedule\b/);
    });

    it('still returns onCallSchedules state', () => {
        expect(src).toMatch(/onCallSchedules,/);
    });
});
