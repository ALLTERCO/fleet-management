/** Unit tests for helpers/ruleValidators — one rule per describe block,
 *  test names describe the rule rather than mirror the function name. */

import {describe, expect, it} from 'vitest';
import {
    validateCooldownSec,
    validateDedupeWindowSec,
    validateDestinationGroupIds,
    validateDigestWindowMinutes,
    validateRuleName,
    validateRuleTemplate,
    validateScopeIsNonEmpty,
    validateSeverity
} from '@/helpers/ruleValidators';

describe('rule name rule', () => {
    it('accepts a typical short name', () => {
        expect(validateRuleName('Battery low').valid).toBe(true);
    });

    it('rejects an empty name with a required-field message', () => {
        const result = validateRuleName('');
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.message).toMatch(/required/i);
    });

    it('rejects whitespace-only input', () => {
        expect(validateRuleName('   ').valid).toBe(false);
    });

    it('rejects a single-character name', () => {
        expect(validateRuleName('a').valid).toBe(false);
    });

    it('rejects a name above the upper length bound', () => {
        expect(validateRuleName('a'.repeat(121)).valid).toBe(false);
    });
});

describe('severity rule', () => {
    it('accepts the info level', () => {
        expect(validateSeverity('info').valid).toBe(true);
    });

    it('accepts the warning level', () => {
        expect(validateSeverity('warning').valid).toBe(true);
    });

    it('accepts the critical level', () => {
        expect(validateSeverity('critical').valid).toBe(true);
    });

    it('rejects an unknown severity string', () => {
        expect(validateSeverity('emergency').valid).toBe(false);
    });
});

describe('dedupe window rule', () => {
    it('accepts a fresh-zero dedupe window', () => {
        expect(validateDedupeWindowSec(0).valid).toBe(true);
    });

    it('accepts a one-hour dedupe window', () => {
        expect(validateDedupeWindowSec(3600).valid).toBe(true);
    });

    it('rejects a negative dedupe window', () => {
        expect(validateDedupeWindowSec(-1).valid).toBe(false);
    });

    it('rejects a dedupe window longer than one day', () => {
        expect(validateDedupeWindowSec(86401).valid).toBe(false);
    });

    it('rejects a fractional value', () => {
        expect(validateDedupeWindowSec(60.5).valid).toBe(false);
    });
});

describe('cooldown rule', () => {
    it('accepts a one-day cooldown', () => {
        expect(validateCooldownSec(86400).valid).toBe(true);
    });

    it('rejects a cooldown longer than a week', () => {
        expect(validateCooldownSec(7 * 86400 + 1).valid).toBe(false);
    });
});

describe('digest window rule', () => {
    it('accepts null because null means platform default', () => {
        expect(validateDigestWindowMinutes(null).valid).toBe(true);
    });

    it('accepts a sensible 60-minute digest', () => {
        expect(validateDigestWindowMinutes(60).valid).toBe(true);
    });

    it('rejects a zero-minute digest because it would degenerate to instant', () => {
        expect(validateDigestWindowMinutes(0).valid).toBe(false);
    });

    it('rejects a digest longer than a day', () => {
        expect(validateDigestWindowMinutes(2000).valid).toBe(false);
    });
});

describe('template rule', () => {
    it('accepts a null template', () => {
        expect(validateRuleTemplate(null).valid).toBe(true);
    });

    it('accepts a short template body', () => {
        expect(
            validateRuleTemplate('Device {{device.name}} offline').valid
        ).toBe(true);
    });

    it('rejects a template above the length cap', () => {
        expect(validateRuleTemplate('x'.repeat(2001)).valid).toBe(false);
    });
});

describe('destination groups rule', () => {
    it('accepts a single positive destination', () => {
        expect(validateDestinationGroupIds([7]).valid).toBe(true);
    });

    it('rejects an empty destination list', () => {
        expect(validateDestinationGroupIds([]).valid).toBe(false);
    });

    it('rejects a list containing a non-positive id', () => {
        expect(validateDestinationGroupIds([5, 0]).valid).toBe(false);
    });
});

describe('scope non-empty rule', () => {
    it('accepts a scope with a single device', () => {
        expect(validateScopeIsNonEmpty({deviceIds: ['abc']}).valid).toBe(true);
    });

    it('accepts a scope built only from groups', () => {
        expect(validateScopeIsNonEmpty({groupIds: [1]}).valid).toBe(true);
    });

    it('rejects an empty scope across every bucket', () => {
        expect(
            validateScopeIsNonEmpty({
                deviceIds: [],
                componentIds: [],
                groupIds: [],
                locationIds: [],
                tagIds: []
            }).valid
        ).toBe(false);
    });
});
