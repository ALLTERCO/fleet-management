import assert from 'node:assert/strict';
import {test} from 'node:test';
import {paginateAndBuild} from '../src/rpc/listResponse';

test('paginateAndBuild rejects negative limits before computing has_more', () => {
    assert.throws(
        () => paginateAndBuild([1, 2, 3], {limit: -1}),
        /limit must be >= 0/
    );
});

test('paginateAndBuild keeps limit zero as the unlimited API contract', () => {
    assert.deepEqual(paginateAndBuild(['a', 'b', 'c'], {limit: 0, offset: 1}), {
        items: ['b', 'c'],
        total: 3,
        limit: 0,
        offset: 1,
        has_more: false
    });
});
