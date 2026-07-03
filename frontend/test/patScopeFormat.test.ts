import {describe, expect, it} from 'vitest';
import {formatBoundaryScope} from '@/helpers/patScopeFormat';

describe('formatBoundaryScope — one-line PAT row summary', () => {
    it('reports "all" when no scope is set so users know the token is unrestricted', () => {
        expect(formatBoundaryScope(undefined)).toBe('all');
    });

    it('reports "all" for an empty scope object because no keys means no boundary', () => {
        expect(formatBoundaryScope({})).toBe('all');
    });

    it('reports "all" for null scope so callers can pass the raw column', () => {
        expect(formatBoundaryScope(null)).toBe('all');
    });

    it('renders a single scalar as key=value so the cell stays short', () => {
        expect(formatBoundaryScope({deviceId: 'abc'})).toBe('deviceId=abc');
    });

    it('renders arrays as a count so a 200-id scope does not blow the cell', () => {
        expect(formatBoundaryScope({devices: ['a', 'b', 'c']})).toBe('devices=[3]');
    });

    it('joins multiple keys with the bullet so the row is glanceable', () => {
        const out = formatBoundaryScope({deviceId: 'abc', orgId: 'org-1'});
        expect(out).toContain('deviceId=abc');
        expect(out).toContain('orgId=org-1');
        expect(out).toContain(' · ');
    });
});
