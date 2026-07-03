import {describe, expect, it} from 'vitest';

import {
    buildServiceUserAccessAssignment,
    serviceUserAccessPreviewRows,
    serviceUserAssignmentLabel,
    serviceUserScopeLabel
} from '../src/helpers/serviceUserAccessPlan';

describe('serviceUserAccessPlan', () => {
    it('builds an all-resource assignment with a trimmed reason', () => {
        expect(
            buildServiceUserAccessAssignment(
                {
                    personaId: ' persona-1 ',
                    scopeAll: true,
                    scope: {},
                    reason: ' dashboard automation '
                },
                'viewer'
            )
        ).toEqual({
            personaId: 'persona-1',
            scope: {all: true},
            reason: 'dashboard automation'
        });
    });

    it('builds a narrowed assignment from the picked boundary', () => {
        expect(
            buildServiceUserAccessAssignment(
                {
                    personaId: 'persona-1',
                    scopeAll: false,
                    scope: {
                        device_tags: ['lobby', 'floor-2'],
                        dashboard_ids: [7]
                    },
                    reason: ''
                },
                'viewer'
            )
        ).toEqual({
            personaId: 'persona-1',
            scope: {device_tags: ['lobby', 'floor-2'], dashboard_ids: [7]}
        });
    });

    it('drops empty dimensions and rejects an empty narrowed scope', () => {
        expect(
            buildServiceUserAccessAssignment(
                {
                    personaId: 'persona-1',
                    scopeAll: false,
                    scope: {device_ids: [], dashboard_ids: []},
                    reason: ''
                },
                'viewer'
            )
        ).toBeNull();
    });

    it('blocks a high-risk human grant without a reason, no expiry needed', () => {
        const draft = {
            personaId: 'persona-1',
            scopeAll: true,
            scope: {},
            reason: ''
        };
        expect(buildServiceUserAccessAssignment(draft, 'admin')).toBeNull();

        const granted = buildServiceUserAccessAssignment(
            {...draft, reason: 'fleet takeover'},
            'admin'
        );
        expect(granted?.reason).toBe('fleet takeover');
        // Humans only say why — machine credentials are the ones that expire.
        expect(granted?.expiresAt).toBeUndefined();
    });

    it('summarizes assignments for preview text', () => {
        const assignment = {
            personaId: 'persona-1',
            scope: {dashboard_ids: [7, 8]},
            reason: 'nightly export'
        };

        expect(serviceUserScopeLabel(assignment.scope)).toBe('2 dashboards');
        expect(serviceUserAssignmentLabel(assignment, 'Viewer')).toBe(
            'Viewer: 2 dashboards — nightly export'
        );
    });

    it('builds explicit access preview rows before service-user creation', () => {
        expect(
            serviceUserAccessPreviewRows({
                role: 'viewer',
                groupNames: ['maintenance-team'],
                assignmentLabels: ['Manager: 2 devices']
            })
        ).toEqual([
            'Built-in role: viewer',
            'Group: maintenance-team',
            'Direct: Manager: 2 devices'
        ]);
    });
});
