import {describe, expect, it} from 'vitest';
import {
    buildServiceUserCreatePayload,
    deriveServiceUsername,
    serviceUserAccessReady
} from '../src/helpers/serviceUserCreate';

describe('deriveServiceUsername', () => {
    it('slugifies friendly names', () => {
        expect(deriveServiceUsername('CI Pipeline')).toBe('ci-pipeline');
        expect(deriveServiceUsername('  Backup (nightly) #2 ')).toBe(
            'backup-nightly-2'
        );
        expect(deriveServiceUsername('')).toBe('');
    });
});

describe('buildServiceUserCreatePayload', () => {
    it('omits blank optional fields when no starter role is chosen', () => {
        expect(
            buildServiceUserCreatePayload({
                userName: '  svc-ci  ',
                name: '  CI Worker  ',
                description: '  ',
                personaId: '  ',
                scopeAll: true,
                scope: {},
                accessReason: '',
                accessExpiresDays: '365'
            })
        ).toEqual({
            userName: 'svc-ci',
            name: 'CI Worker'
        });
    });

    it('attaches the starter role with full scope when "all" is chosen', () => {
        expect(
            buildServiceUserCreatePayload({
                userName: 'svc-ci',
                name: 'CI Worker',
                description: 'pipeline',
                personaId: ' persona-1 ',
                scopeAll: true,
                scope: {},
                accessReason: '',
                accessExpiresDays: '365'
            })
        ).toEqual({
            userName: 'svc-ci',
            name: 'CI Worker',
            description: 'pipeline',
            assignments: [{personaId: 'persona-1', scope: {all: true}}]
        });
    });

    it('narrows the starter role to the picked resources when scoped', () => {
        expect(
            buildServiceUserCreatePayload({
                userName: 'svc-ci',
                name: 'CI Worker',
                description: '',
                personaId: 'persona-1',
                scopeAll: false,
                scope: {dashboard_ids: [7]},
                accessReason: '',
                accessExpiresDays: '365'
            })
        ).toEqual({
            userName: 'svc-ci',
            name: 'CI Worker',
            assignments: [{personaId: 'persona-1', scope: {dashboard_ids: [7]}}]
        });
    });

    it('drops the assignment when scoped but no resource is picked', () => {
        expect(
            buildServiceUserCreatePayload({
                userName: 'svc-ci',
                name: 'CI Worker',
                description: '',
                personaId: 'persona-1',
                scopeAll: false,
                scope: {},
                accessReason: '',
                accessExpiresDays: '365'
            })
        ).toEqual({userName: 'svc-ci', name: 'CI Worker'});
    });
});

describe('buildServiceUserCreatePayload — high-risk grants', () => {
    it('attaches reason and expiry for admin with everything', () => {
        const payload = buildServiceUserCreatePayload(
            {
                userName: 'svc-ci',
                name: 'CI Worker',
                description: '',
                personaId: 'persona-1',
                scopeAll: true,
                scope: {},
                accessReason: '  CI rollout  ',
                accessExpiresDays: '90'
            },
            'admin'
        );
        const assignment = payload.assignments?.[0];
        expect(assignment?.reason).toBe('CI rollout');
        // ISO date in the future, ~90 days out.
        const expiresAt = Date.parse(assignment?.expiresAt ?? '');
        expect(expiresAt).toBeGreaterThan(Date.now() + 89 * 86_400_000);
        expect(expiresAt).toBeLessThan(Date.now() + 91 * 86_400_000);
    });

    it('sends no metadata for non-high-risk grants', () => {
        const payload = buildServiceUserCreatePayload(
            {
                userName: 'svc-ci',
                name: 'CI Worker',
                description: '',
                personaId: 'persona-1',
                scopeAll: true,
                scope: {},
                accessReason: '',
                accessExpiresDays: '365'
            },
            'viewer'
        );
        expect(payload.assignments?.[0]).toEqual({
            personaId: 'persona-1',
            scope: {all: true}
        });
    });
});

describe('serviceUserAccessReady', () => {
    function form(
        overrides: Partial<Parameters<typeof serviceUserAccessReady>[0]> = {}
    ) {
        return {
            userName: 'svc',
            name: 'svc',
            description: '',
            personaId: 'p1',
            scopeAll: true,
            scope: {},
            accessReason: '',
            accessExpiresDays: '365',
            ...overrides
        };
    }

    it('is false without a role', () => {
        expect(serviceUserAccessReady(form({personaId: ''}), 'viewer')).toBe(
            false
        );
    });

    it('is true with a role scoped to all resources', () => {
        expect(serviceUserAccessReady(form(), 'viewer')).toBe(true);
    });

    it('is false when scoped to nothing', () => {
        expect(serviceUserAccessReady(form({scopeAll: false}), 'viewer')).toBe(
            false
        );
    });

    it('is true when scoped to a picked resource', () => {
        expect(
            serviceUserAccessReady(
                form({scopeAll: false, scope: {device_ids: ['d1']}}),
                'viewer'
            )
        ).toBe(true);
    });

    it('requires a reason for admin or manager with everything', () => {
        expect(serviceUserAccessReady(form(), 'admin')).toBe(false);
        expect(serviceUserAccessReady(form(), 'manager')).toBe(false);
        expect(
            serviceUserAccessReady(form({accessReason: 'CI rollout'}), 'admin')
        ).toBe(true);
        // Scoped admin grants are not high-risk — no reason needed.
        expect(
            serviceUserAccessReady(
                form({scopeAll: false, scope: {device_ids: ['d1']}}),
                'admin'
            )
        ).toBe(true);
    });
});
