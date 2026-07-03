import type {AlertInstance} from '@api/alert';
import {describe, expect, it} from 'vitest';
import {__testing} from '@/composables/usePinAlertCounts';

const {locationIdFromSource, isOpen, tallyByLocation} = __testing;

describe('locationIdFromSource', () => {
    it('returns the numeric id when the alert points at a location', () => {
        expect(
            locationIdFromSource(
                alert({subjectType: 'location', subjectId: '7'})
            )
        ).toBe(7);
    });
    it('returns undefined for non-location subjects', () => {
        expect(
            locationIdFromSource(
                alert({subjectType: 'device', subjectId: 'shelly-1'})
            )
        ).toBeUndefined();
    });
    it('returns undefined when the id is not numeric', () => {
        expect(
            locationIdFromSource(
                alert({subjectType: 'location', subjectId: 'abc'})
            )
        ).toBeUndefined();
    });
});

describe('isOpen', () => {
    it('includes active, acknowledged, cleared_unack', () => {
        expect(isOpen(alert({state: 'active'}))).toBe(true);
        expect(isOpen(alert({state: 'acknowledged'}))).toBe(true);
        expect(isOpen(alert({state: 'cleared_unack'}))).toBe(true);
    });
    it('excludes cleared_ack and resolved', () => {
        expect(isOpen(alert({state: 'cleared_ack'}))).toBe(false);
        expect(isOpen(alert({state: 'resolved'}))).toBe(false);
    });
});

describe('tallyByLocation', () => {
    it('sums only open alerts whose subject is a location', () => {
        const counts = tallyByLocation([
            alert({state: 'active', subjectType: 'location', subjectId: '1'}),
            alert({
                state: 'acknowledged',
                subjectType: 'location',
                subjectId: '1'
            }),
            alert({state: 'resolved', subjectType: 'location', subjectId: '1'}),
            alert({
                state: 'active',
                subjectType: 'device',
                subjectId: 'shelly-1'
            })
        ]);
        expect(counts.get(1)).toBe(2);
        expect(counts.size).toBe(1);
    });
});

interface AlertOverrides {
    state?: AlertInstance['state'];
    subjectType?: 'location' | 'device' | 'group' | 'tag' | 'entity';
    subjectId?: string;
}

function alert(overrides: AlertOverrides = {}): AlertInstance {
    return {
        id: 1,
        organizationId: 'org-1',
        ruleId: 1,
        ruleKind: 'device_offline',
        state: overrides.state ?? 'active',
        severity: 'warning',
        source: {
            organizationId: 'org-1',
            subjectType: overrides.subjectType ?? 'device',
            subjectId: overrides.subjectId ?? 'shelly-1'
        },
        title: 't',
        message: 'm',
        fingerprint: 'fp',
        activeSince: '2026-05-29T00:00:00.000Z',
        lastTriggeredAt: '2026-05-29T00:00:00.000Z',
        acknowledgedAt: null,
        acknowledgedBy: null,
        ackComment: null,
        resolvedAt: null,
        silencedUntil: null,
        silenceReason: null,
        counts: {notificationsCreated: 0, deliveryJobsCreated: 0},
        context: {}
    };
}
