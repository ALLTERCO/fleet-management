import type {AlertInstance} from '@api/alert';
import {describe, expect, it} from 'vitest';
import {__testing} from '@/composables/useOpenAlerts';

const {isOpen, compareInstanceBySeverity, selectOpenInstances, topSeverity} =
    __testing;

describe('isOpen', () => {
    it('admits active, acknowledged, and cleared-unack states', () => {
        expect(isOpen(alert({state: 'active'}))).toBe(true);
        expect(isOpen(alert({state: 'acknowledged'}))).toBe(true);
        expect(isOpen(alert({state: 'cleared_unack'}))).toBe(true);
    });
    it('rejects cleared-ack and resolved states', () => {
        expect(isOpen(alert({state: 'cleared_ack'}))).toBe(false);
        expect(isOpen(alert({state: 'resolved'}))).toBe(false);
    });
});

describe('compareInstanceBySeverity', () => {
    it('places critical instances before warnings', () => {
        const crit = alert({severity: 'critical'});
        const warn = alert({severity: 'warning'});
        expect(compareInstanceBySeverity(crit, warn)).toBeLessThan(0);
    });
    it('breaks severity ties by newer activeSince', () => {
        const newer = alert({
            severity: 'warning',
            activeSince: '2026-05-29T12:00:00.000Z'
        });
        const older = alert({
            severity: 'warning',
            activeSince: '2026-05-28T08:00:00.000Z'
        });
        expect(compareInstanceBySeverity(newer, older)).toBeLessThan(0);
    });
});

describe('selectOpenInstances', () => {
    it('returns open instances sorted by severity', () => {
        const list = [
            alert({id: 1, severity: 'info', state: 'active'}),
            alert({id: 2, severity: 'critical', state: 'active'}),
            alert({id: 3, severity: 'critical', state: 'resolved'}),
            alert({id: 4, severity: 'warning', state: 'acknowledged'})
        ];
        expect(selectOpenInstances(list).map((i) => i.id)).toEqual([2, 4, 1]);
    });
});

describe('topSeverity', () => {
    it('reports the highest severity from a sorted open list', () => {
        const open = [
            alert({severity: 'critical'}),
            alert({severity: 'warning'})
        ];
        expect(topSeverity(open)).toBe('critical');
    });
    it('reports null when there are no open alerts', () => {
        expect(topSeverity([])).toBeNull();
    });
});

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
