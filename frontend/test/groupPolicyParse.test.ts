// One purpose per test — describes the rule, not the function symbol.

import {describe, expect, it} from 'vitest';
import {
    buildPolicyFromForm,
    configProfileFromMetadata,
    isMetadataRecord,
    parsePositiveInt,
    policyFromMetadata
} from '@/helpers/groupPolicyParse';

describe('isMetadataRecord — distinguishes objects we can index', () => {
    it('accepts a plain object so callers can read its keys safely', () => {
        expect(isMetadataRecord({a: 1})).toBe(true);
    });

    it('rejects arrays because index access there has different semantics', () => {
        expect(isMetadataRecord([1, 2])).toBe(false);
    });

    it('rejects null because typeof null is "object" but we cannot index it', () => {
        expect(isMetadataRecord(null)).toBe(false);
    });

    it('rejects primitives so non-object inputs fail the guard cleanly', () => {
        expect(isMetadataRecord('s')).toBe(false);
        expect(isMetadataRecord(7)).toBe(false);
    });
});

describe('configProfileFromMetadata — reads metadata.configProfile string', () => {
    it('returns the string when present so the picker has a starting value', () => {
        expect(configProfileFromMetadata({configProfile: 'enterprise'})).toBe(
            'enterprise'
        );
    });

    it('returns empty string when configProfile is missing', () => {
        expect(configProfileFromMetadata({})).toBe('');
    });

    it('returns empty string when metadata is not an object so it never crashes', () => {
        expect(configProfileFromMetadata(null)).toBe('');
    });
});

describe('policyFromMetadata — reads metadata.policy as an object', () => {
    it('returns the policy object when present so the form can hydrate', () => {
        const p = policyFromMetadata({policy: {retentionDays: 30}});
        expect(p.retentionDays).toBe(30);
    });

    it('returns {} when policy is missing so callers can assume an object', () => {
        expect(policyFromMetadata({})).toEqual({});
    });

    it('returns {} when policy is an array because index access would lie', () => {
        expect(policyFromMetadata({policy: [1, 2]})).toEqual({});
    });
});

describe('parsePositiveInt — strict positive integer', () => {
    it('accepts empty input as undefined because empty means inherit', () => {
        expect(parsePositiveInt('', 'X')).toEqual({ok: true, value: undefined});
    });

    it('accepts whitespace-only as undefined because empty really means empty', () => {
        expect(parsePositiveInt('   ', 'X')).toEqual({ok: true, value: undefined});
    });

    it('accepts a positive integer so the typical case stores the number', () => {
        expect(parsePositiveInt('30', 'X')).toEqual({ok: true, value: 30});
    });

    it('rejects zero because policy requires a positive integer', () => {
        const r = parsePositiveInt('0', 'X');
        expect(r.ok).toBe(false);
    });

    it('rejects negative input', () => {
        const r = parsePositiveInt('-3', 'X');
        expect(r.ok).toBe(false);
    });

    it('rejects fractional input because parseInt would silently truncate', () => {
        const r = parsePositiveInt('3.5', 'X');
        expect(r.ok).toBe(false);
    });

    it('rejects trailing characters like "30days" so paste mistakes surface', () => {
        const r = parsePositiveInt('30days', 'X');
        expect(r.ok).toBe(false);
    });
});

describe('buildPolicyFromForm — assemble PolicyShape from form state', () => {
    it('returns undefined data when every field is empty so callers can omit policy', () => {
        const r = buildPolicyFromForm({
            severityFloor: '',
            retentionDaysText: '',
            auditRetentionDaysText: ''
        });
        expect(r).toEqual({ok: true, data: undefined});
    });

    it('returns the populated shape when fields are filled', () => {
        const r = buildPolicyFromForm({
            severityFloor: 'warning',
            retentionDaysText: '30',
            auditRetentionDaysText: '60'
        });
        expect(r).toEqual({
            ok: true,
            data: {
                severityFloor: 'warning',
                retentionDays: 30,
                auditRetentionDays: 60
            }
        });
    });

    it('omits a field left on its default while keeping the overridden ones — "use default" drops just that key', () => {
        const r = buildPolicyFromForm({
            severityFloor: 'critical',
            retentionDaysText: '',
            auditRetentionDaysText: '90'
        });
        expect(r).toEqual({
            ok: true,
            data: {severityFloor: 'critical', auditRetentionDays: 90}
        });
        if (r.ok && r.data) {
            expect('retentionDays' in r.data).toBe(false);
        }
    });

    it('returns per-field errors when both numeric fields are bad so the form can highlight both at once', () => {
        const r = buildPolicyFromForm({
            severityFloor: '',
            retentionDaysText: 'abc',
            auditRetentionDaysText: '-1'
        });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.errors.retentionDays).toContain('Retention days');
            expect(r.errors.auditRetentionDays).toContain('Audit retention');
        }
    });
});
