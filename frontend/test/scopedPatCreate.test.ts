import {describe, expect, it} from 'vitest';

import {
    buildBoundaryScope,
    buildPatCreatePlan
} from '../src/helpers/scopedPatCreate';

describe('scoped PAT create planning', () => {
    it('builds a Zitadel PAT plan without preview', () => {
        expect(
            buildPatCreatePlan({
                userId: 'svc-1',
                expirationDaysText: '30',
                scoped: false,
                scopeAll: true,
                pickedScope: {},
                purpose: ''
            })
        ).toEqual({
            kind: 'zitadel_pat',
            createMethod: 'User.CreatePAT',
            createParams: {
                userId: 'svc-1',
                expirationDays: 30
            }
        });
    });

    it('builds a scoped PAT plan that requires preview before create', () => {
        expect(
            buildPatCreatePlan({
                userId: 'svc-1',
                expirationDaysText: '365',
                scoped: true,
                scopeAll: false,
                pickedScope: {
                    device_ids: ['shelly-1'],
                    dashboard_ids: []
                },
                purpose: 'automation'
            })
        ).toEqual({
            kind: 'fm_scoped_pat',
            previewMethod: 'User.PreviewScopedPAT',
            previewParams: {
                userId: 'svc-1',
                boundaryScope: {device_ids: ['shelly-1']}
            },
            createMethod: 'User.CreateScopedPAT',
            createParams: {
                userId: 'svc-1',
                boundaryScope: {device_ids: ['shelly-1']},
                purpose: 'automation',
                expirationDays: 365
            }
        });
    });

    it('uses all-scope as an explicit no-narrowing boundary', () => {
        expect(
            buildBoundaryScope({
                scopeAll: true,
                pickedScope: {device_ids: ['ignored']}
            })
        ).toEqual({all: true});
    });

    it('rejects scoped token plans with no explicit boundary', () => {
        expect(() =>
            buildPatCreatePlan({
                userId: 'svc-1',
                expirationDaysText: '',
                scoped: true,
                scopeAll: false,
                pickedScope: {device_ids: []},
                purpose: 'automation'
            })
        ).toThrow(/At least one scope/);
    });

    it('rejects scoped token plans without purpose', () => {
        expect(() =>
            buildPatCreatePlan({
                userId: 'svc-1',
                expirationDaysText: '',
                scoped: true,
                scopeAll: true,
                pickedScope: {},
                purpose: ' '
            })
        ).toThrow(/Purpose is required/);
    });
});
