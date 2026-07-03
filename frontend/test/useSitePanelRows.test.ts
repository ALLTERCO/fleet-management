import type {AlertInstance} from '@api/alert';
import type {Location as ApiLocation} from '@api/location';
import {describe, expect, it} from 'vitest';
import type {LocationHealth} from '@/composables/useLocationStatus';
import {__testing as alertTesting} from '@/composables/usePinAlertCounts';
import {__testing} from '@/composables/useSitePanelRows';

const {isSiteLike, locationSummary, compareRowSeverity, buildSitePanelRows} =
    __testing;
const {tallyByLocation} = alertTesting;

describe('locationSummary', () => {
    it('joins city and country into a comma-separated label', () => {
        const loc = location({
            kindFields: {address: {city: 'Sofia', countryCode: 'BG'}}
        });
        expect(locationSummary(loc)).toBe('Sofia, BG');
    });
    it('returns an empty label when no address is set', () => {
        expect(locationSummary(location({kindFields: {}}))).toBe('');
    });
});

describe('isSiteLike', () => {
    it('admits sites and buildings; rejects cities', () => {
        expect(isSiteLike(location({kind: 'site'}))).toBe(true);
        expect(isSiteLike(location({kind: 'building'}))).toBe(true);
        expect(isSiteLike(location({kind: 'city'}))).toBe(false);
    });
});

describe('tallyByLocation (shared via usePinAlertCounts)', () => {
    it('tallies open alerts per location subject id', () => {
        const counts = tallyByLocation([
            alertOnLocation(1, 'active'),
            alertOnLocation(1, 'acknowledged'),
            alertOnLocation(2, 'active'),
            alertOnLocation(1, 'resolved'),
            alertOnDevice('shelly-1', 'active')
        ]);
        expect(counts.get(1)).toBe(2);
        expect(counts.get(2)).toBe(1);
        expect(counts.has(99)).toBe(false);
    });
});

describe('compareRowSeverity', () => {
    it('puts rows with more alerts before rows with fewer', () => {
        const high = row({id: 1, name: 'A', alertCount: 5});
        const low = row({id: 2, name: 'B', alertCount: 1});
        expect(compareRowSeverity(high, low)).toBeLessThan(0);
    });
    it('breaks alert ties by status severity', () => {
        const offline = row({id: 1, name: 'A', status: 'off'});
        const online = row({id: 2, name: 'B', status: 'on'});
        expect(compareRowSeverity(offline, online)).toBeLessThan(0);
    });
});

describe('buildSitePanelRows', () => {
    it('returns site-kind locations only, sorted by severity', () => {
        const locations = [
            location({id: 1, kind: 'country', name: 'Country'}),
            location({id: 2, kind: 'site', name: 'Quiet Site'}),
            location({id: 3, kind: 'site', name: 'Burning Site'})
        ];
        const health = new Map<number, LocationHealth>([
            [2, {total: 3, online: 3, status: 'on'}],
            [3, {total: 3, online: 0, status: 'off'}]
        ]);
        const alertsByLocation = new Map<number, number>([[3, 2]]);
        const rows = buildSitePanelRows(locations, health, alertsByLocation);
        expect(rows.map((r) => r.id)).toEqual([3, 2]);
        expect(rows[0].alertCount).toBe(2);
        expect(rows[1].status).toBe('on');
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

function row(
    overrides: Partial<ReturnType<typeof __testing.buildSitePanelRows>[number]>
) {
    return {
        id: 1,
        name: 'L',
        summary: '',
        status: 'on' as const,
        online: 0,
        total: 0,
        alertCount: 0,
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

function alertOnLocation(
    locationId: number,
    state: AlertInstance['state']
): AlertInstance {
    return alert({
        state,
        source: {
            organizationId: 'org-1',
            subjectType: 'location',
            subjectId: String(locationId)
        }
    });
}

function alertOnDevice(
    deviceId: string,
    state: AlertInstance['state']
): AlertInstance {
    return alert({
        state,
        source: {
            organizationId: 'org-1',
            subjectType: 'device',
            subjectId: deviceId
        }
    });
}
