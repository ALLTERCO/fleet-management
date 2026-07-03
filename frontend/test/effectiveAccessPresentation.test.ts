import type {EffectiveAccessProvenance} from '@api/authz';
import {describe, expect, it} from 'vitest';

import {
    assignmentDetails,
    emptyEffectiveAccessProvenance,
    formatAssignmentSource,
    formatAssignmentSummary,
    formatBaseRoles,
    formatConditionSummary,
    formatScopeSummary,
    hasStatementCondition
} from '../src/helpers/effectiveAccessPresentation';

describe('effective access presentation', () => {
    it('formats empty and populated base roles', () => {
        expect(formatBaseRoles([])).toBe('(none)');
        expect(formatBaseRoles(['viewer', 'admin'])).toBe('viewer, admin');
    });

    it('summarizes scopes without hiding resource type counts', () => {
        expect(
            formatScopeSummary({
                device_ids: ['a', 'b'],
                dashboard_ids: [7],
                notification_ids: ['n1']
            })
        ).toBe('Scoped: 2 devices · 1 dashboards · 1 notifications');
    });

    it('formats assignment source and summary', () => {
        const entry = directAssignment();

        expect(formatAssignmentSource(entry)).toBe('Direct');
        expect(formatAssignmentSummary(entry)).toBe(
            'manager: device.read, device.update · Scoped: 1 devices'
        );
    });

    it('surfaces grantor, subject, expiry, and assignment provenance', () => {
        expect(assignmentDetails(directAssignment())).toEqual([
            {label: 'Subject', value: 'user: target-user'},
            {label: 'Grantor', value: 'admin-user'},
            {label: 'Expires', value: '2026-05-22T00:00:00.000Z'},
            {label: 'Assignment', value: 'assignment-1'}
        ]);
    });

    it('omits missing provenance details', () => {
        expect(
            assignmentDetails({
                ...directAssignment(),
                subjectId: undefined,
                grantorId: undefined,
                expiresAt: undefined,
                assignmentId: undefined
            })
        ).toEqual([]);
    });

    it('formats statement conditions', () => {
        const statement = {
            effect: 'ALLOW' as const,
            actions: ['device.read'],
            resourceTypes: ['device'],
            scope: {all: true},
            condition: {
                mfa: {required: true},
                ip: {cidrs: ['10.0.0.0/8']},
                time: {window: {start: '09:00', end: '17:00'}}
            }
        };

        expect(hasStatementCondition(statement)).toBe(true);
        expect(formatConditionSummary(statement)).toBe(
            'MFA required · IP: 10.0.0.0/8 · Time: 09:00–17:00'
        );
    });

    it('returns an empty provenance shape for reset state', () => {
        expect(emptyEffectiveAccessProvenance()).toEqual({
            baseRoles: [],
            directAssignments: [],
            groupAssignments: []
        });
    });
});

function directAssignment(): EffectiveAccessProvenance {
    return {
        source: 'user-assignment',
        persona: 'manager',
        assignmentId: 'assignment-1',
        subjectType: 'user',
        subjectId: 'target-user',
        grantorId: 'admin-user',
        expiresAt: Date.parse('2026-05-22T00:00:00.000Z'),
        actions: ['device.read', 'device.update'],
        resourceTypes: ['device'],
        scope: {device_ids: ['shelly-1']},
        effect: 'ALLOW'
    };
}
