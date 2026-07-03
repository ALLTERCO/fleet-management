import type {AlertInstance} from '@api/alert';
import type {Location as ApiLocation} from '@api/location';
import {describe, expect, it} from 'vitest';
import {__testing} from '@/composables/useFleetPulse';
import type {LocationHealth} from '@/composables/useLocationStatus';

const {isSiteLike, countSiteTotals, countOpenAlerts} = __testing;

describe('isSiteLike', () => {
    it('claims building locations as site-like', () => {
        expect(isSiteLike(location({kind: 'building'}))).toBe(true);
    });
    it('rejects country and city locations', () => {
        expect(isSiteLike(location({kind: 'country'}))).toBe(false);
        expect(isSiteLike(location({kind: 'city'}))).toBe(false);
    });
});

describe('countSiteTotals', () => {
    it('totals only site-kind locations and counts on-status as online', () => {
        const locations = [
            location({id: 1, kind: 'country'}),
            location({id: 2, kind: 'site'}),
            location({id: 3, kind: 'site'}),
            location({id: 4, kind: 'building'})
        ];
        const health = new Map<number, LocationHealth>([
            [1, {total: 10, online: 10, status: 'on'}],
            [2, {total: 5, online: 5, status: 'on'}],
            [3, {total: 4, online: 2, status: 'warn'}],
            [4, {total: 3, online: 3, status: 'on'}]
        ]);
        expect(countSiteTotals(locations, health)).toEqual({
            online: 2,
            total: 3
        });
    });
});

describe('countOpenAlerts', () => {
    it('counts active, acknowledged, and cleared-unack alerts as open', () => {
        const open = countOpenAlerts([
            alert({state: 'active'}),
            alert({state: 'acknowledged'}),
            alert({state: 'cleared_unack'}),
            alert({state: 'cleared_ack'}),
            alert({state: 'resolved'})
        ]);
        expect(open).toBe(3);
    });
});

function location(overrides: Partial<ApiLocation>): ApiLocation {
    return {
        id: 1,
        organizationId: 'org-1',
        name: 'L',
        kind: 'site',
        parentLocationId: null,
        sortOrder: 0,
        kindFields: {},
        customFields: {},
        effective: {
            timezone: null,
            countryCode: null,
            currency: null,
            regulatoryZone: null,
            complianceTags: []
        },
        coordinateStatus: {state: 'missing_address', summary: ''},
        createdAt: '2026-05-23T00:00:00.000Z',
        updatedAt: null,
        ...overrides
    };
}

function alert(overrides: Partial<AlertInstance>): AlertInstance {
    return {
        id: 1,
        organizationId: 'org-1',
        ruleId: 1,
        ruleKind: 'device_offline',
        state: 'active',
        severity: 'warning',
        source: {
            organizationId: 'org-1',
            subjectType: 'device',
            subjectId: 'shelly-1'
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
        context: {},
        ...overrides
    };
}
