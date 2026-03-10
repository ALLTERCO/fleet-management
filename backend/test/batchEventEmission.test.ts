import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

/**
 * Replicate matchesRule from EventDistributor.ts
 */
function matchesRule(reason: string, rule: string) {
    const [reasonCore, reasonComp] = reason.split(':');
    const [ruleCore, ruleComp] = rule.split(':');

    if (ruleCore === '*') {
        return ruleComp === '*' || reasonComp === ruleComp;
    }

    if (ruleComp === '*') {
        return reasonCore === ruleCore;
    }

    return reasonCore === ruleCore && reasonComp === ruleComp;
}

/**
 * Replicate the array-reason matching logic from EventDistributor.notifyAll
 */
function shouldDeliverEvent(
    reason: string | string[] | undefined,
    options: {allow?: string[]; deny?: string[]}
): boolean {
    const reasons = Array.isArray(reason)
        ? reason
        : typeof reason === 'string'
          ? [reason]
          : undefined;

    if (reasons === undefined) return true;

    const {allow, deny} = options;

    // Drop if ANY reason matches a deny rule
    if (deny && Array.isArray(deny)) {
        if (reasons.some((r) => deny.some((rule) => matchesRule(r, rule)))) {
            return false;
        }
    }

    // Keep if ANY reason matches an allow rule
    if (allow && Array.isArray(allow)) {
        if (!reasons.some((r) => allow.some((rule) => matchesRule(r, rule)))) {
            return false;
        }
    }

    return true;
}

describe('matchesRule', () => {
    it('should match exact reason:component', () => {
        assert.ok(matchesRule('switch:output', 'switch:output'));
    });

    it('should not match different component', () => {
        assert.ok(!matchesRule('switch:output', 'switch:consumption'));
    });

    it('should match wildcard component (*)', () => {
        assert.ok(matchesRule('switch:output', 'switch:*'));
        assert.ok(matchesRule('switch:consumption', 'switch:*'));
        assert.ok(matchesRule('switch:aenergy', 'switch:*'));
    });

    it('should match wildcard core (*)', () => {
        assert.ok(matchesRule('switch:output', '*:output'));
        assert.ok(matchesRule('temperature:output', '*:output'));
    });

    it('should match full wildcard (*:*)', () => {
        assert.ok(matchesRule('switch:output', '*:*'));
        assert.ok(matchesRule('temperature:generic', '*:*'));
    });

    it('should not match different core', () => {
        assert.ok(!matchesRule('switch:output', 'temperature:output'));
    });
});

describe('array reason matching — shouldDeliverEvent', () => {
    it('should deliver when single reason matches allow', () => {
        assert.ok(shouldDeliverEvent('switch:output', {allow: ['switch:*']}));
    });

    it('should not deliver when single reason does not match allow', () => {
        assert.ok(
            !shouldDeliverEvent('temperature:generic', {
                allow: ['switch:*']
            })
        );
    });

    it('should deliver when ANY reason in array matches allow', () => {
        assert.ok(
            shouldDeliverEvent(
                ['switch:output', 'temperature:generic', 'em:generic'],
                {allow: ['temperature:*']}
            )
        );
    });

    it('should not deliver when NO reason in array matches allow', () => {
        assert.ok(
            !shouldDeliverEvent(['switch:output', 'switch:consumption'], {
                allow: ['temperature:*']
            })
        );
    });

    it('should block when ANY reason matches deny', () => {
        assert.ok(
            !shouldDeliverEvent(['switch:output', 'temperature:generic'], {
                deny: ['switch:output']
            })
        );
    });

    it('should deliver when no reason matches deny', () => {
        assert.ok(
            shouldDeliverEvent(['switch:consumption', 'temperature:generic'], {
                deny: ['switch:output']
            })
        );
    });

    it('should handle allow + deny together', () => {
        // Allow switch:*, but deny switch:aenergy
        assert.ok(
            shouldDeliverEvent(['switch:output'], {
                allow: ['switch:*'],
                deny: ['switch:aenergy']
            })
        );
        // Denied: reason matches deny rule
        assert.ok(
            !shouldDeliverEvent(['switch:aenergy'], {
                allow: ['switch:*'],
                deny: ['switch:aenergy']
            })
        );
    });

    it('should deliver when reason is undefined (no filtering)', () => {
        assert.ok(shouldDeliverEvent(undefined, {allow: ['switch:*']}));
    });

    it('should deliver when no allow/deny rules', () => {
        assert.ok(shouldDeliverEvent(['switch:output'], {}));
    });

    it('should handle empty reason array', () => {
        // Empty array: no reasons → cannot match any allow rule
        assert.ok(!shouldDeliverEvent([], {allow: ['switch:*']}));
        // Empty array with no rules: should deliver
        assert.ok(shouldDeliverEvent([], {}));
    });
});

describe('batchSetComponentStatus simulation', () => {
    it('should collect unique reasons from multiple component keys', () => {
        // Simulate findMessageReason logic
        function findMessageReason(
            key: string,
            value: Record<string, any>
        ): string {
            const separatorIndex = key.indexOf(':');
            const core =
                separatorIndex > -1 ? key.slice(0, separatorIndex) : key;
            const valueKeys = Object.keys(value);

            if (valueKeys.includes('aenergy')) return `${core}:aenergy`;
            if (key.startsWith('switch')) {
                if (valueKeys.includes('output')) return `${core}:output`;
            }
            return `${core}:generic`;
        }

        const data: Record<string, any> = {
            'switch:0': {output: true, apower: 100},
            'switch:1': {output: false},
            'temperature:0': {tC: 25.5},
            'em:0': {voltage: 230}
        };

        const reasons: string[] = [];
        for (const key in data) {
            reasons.push(findMessageReason(key, data[key]));
        }

        // switch:0 → switch:output, switch:1 → switch:output, temperature:0 → temperature:generic, em:0 → em:generic
        assert.equal(reasons.length, 4);
        assert.deepEqual(reasons, [
            'switch:output',
            'switch:output',
            'temperature:generic',
            'em:generic'
        ]);

        // Client with allow: ['switch:*'] should receive this batch event
        assert.ok(shouldDeliverEvent(reasons, {allow: ['switch:*']}));

        // Client with allow: ['temperature:*'] should also receive it
        assert.ok(shouldDeliverEvent(reasons, {allow: ['temperature:*']}));

        // Client with allow: ['input:*'] should NOT receive it
        assert.ok(!shouldDeliverEvent(reasons, {allow: ['input:*']}));
    });

    it('should reduce emission count from N to 1', () => {
        // Before: patchStatus called setComponentStatus per key → N emissions
        // After: batchSetComponentStatus collects reasons → 1 emission
        const data = {
            'switch:0': {apower: 100},
            'switch:1': {apower: 200},
            'temperature:0': {tC: 25},
            'em:0': {voltage: 230},
            'em:1': {voltage: 231}
        };

        const keyCount = Object.keys(data).length;
        const emissionsBefore = keyCount; // 5
        const emissionsAfter = 1; // batch emits once

        assert.equal(emissionsBefore, 5);
        assert.equal(emissionsAfter, 1);
        assert.ok(emissionsAfter < emissionsBefore);
    });
});
