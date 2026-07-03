// UNIT — countByStatus tallies topology nodes into the four health buckets.

import {describe, expect, it} from 'vitest';
import {countByStatus} from '@/helpers/topologyStatusCounts';

describe('countByStatus', () => {
    it('returns zeros for an empty list', () => {
        expect(countByStatus([])).toEqual({
            healthy: 0,
            warning: 0,
            critical: 0,
            unknown: 0
        });
    });

    it('aggregates a mixed list', () => {
        expect(
            countByStatus([
                {status: 'healthy'},
                {status: 'healthy'},
                {status: 'warning'},
                {status: 'critical'},
                {status: 'unknown'}
            ])
        ).toEqual({healthy: 2, warning: 1, critical: 1, unknown: 1});
    });
});
