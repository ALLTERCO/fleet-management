// Pure validators for the alert-rule editor.
//
// Each validator answers "is this value acceptable?" and never mutates
// anything. The result type is a discriminated union so callers can branch
// on `.valid` and rely on TypeScript to narrow the message access.
//
// Naming convention: each function reads as `validate<What>` and its
// matching test reads as a sentence describing the rule it enforces.

import type {AlertSeverity} from '@api/alert';

export type ValidationResult = {valid: true} | {valid: false; message: string};

const VALID: ValidationResult = {valid: true};

function invalid(message: string): ValidationResult {
    return {valid: false, message};
}

const NAME_MIN = 2;
const NAME_MAX = 120;
const TEMPLATE_MAX = 2000;

const DEDUPE_MIN_SEC = 0;
const DEDUPE_MAX_SEC = 24 * 60 * 60;
const COOLDOWN_MIN_SEC = 0;
const COOLDOWN_MAX_SEC = 7 * 24 * 60 * 60;
const DIGEST_MIN_MIN = 1;
const DIGEST_MAX_MIN = 24 * 60;

const SEVERITY_SET = new Set<AlertSeverity>(['info', 'warning', 'critical']);

/** Rule name is required, length-bounded, and trimmed. */
export function validateRuleName(value: string): ValidationResult {
    const trimmed = value.trim();
    if (trimmed.length === 0) return invalid('Name is required');
    if (trimmed.length < NAME_MIN)
        return invalid(`Name must be at least ${NAME_MIN} characters`);
    if (trimmed.length > NAME_MAX)
        return invalid(`Name must be at most ${NAME_MAX} characters`);
    return VALID;
}

/** Severity must be one of the canonical levels. */
export function validateSeverity(value: string): ValidationResult {
    if (!SEVERITY_SET.has(value as AlertSeverity))
        return invalid('Pick a severity');
    return VALID;
}

/** Dedupe window — how long the same fingerprint suppresses re-fire. */
export function validateDedupeWindowSec(
    value: number | string
): ValidationResult {
    return validateSecondsInRange(value, DEDUPE_MIN_SEC, DEDUPE_MAX_SEC);
}

/** Cooldown — how long after firing before the rule may fire again. */
export function validateCooldownSec(value: number | string): ValidationResult {
    return validateSecondsInRange(value, COOLDOWN_MIN_SEC, COOLDOWN_MAX_SEC);
}

/** Digest window in minutes when delivery mode is "digest". */
export function validateDigestWindowMinutes(
    value: number | string | null
): ValidationResult {
    if (value === null) return VALID;
    const minutes = typeof value === 'string' ? Number(value) : value;
    if (!Number.isInteger(minutes))
        return invalid('Digest window must be a whole number of minutes');
    if (minutes < DIGEST_MIN_MIN || minutes > DIGEST_MAX_MIN)
        return invalid(
            `Digest window must be between ${DIGEST_MIN_MIN} and ${DIGEST_MAX_MIN} minutes`
        );
    return VALID;
}

/** Free-text template (summary or message) — capped, may be empty. */
export function validateRuleTemplate(value: string | null): ValidationResult {
    if (value === null || value.length === 0) return VALID;
    if (value.length > TEMPLATE_MAX)
        return invalid(`Template must be at most ${TEMPLATE_MAX} characters`);
    return VALID;
}

/** Routing must name at least one destination group. */
export function validateDestinationGroupIds(
    value: ReadonlyArray<number>
): ValidationResult {
    if (value.length === 0) return invalid('Pick at least one destination');
    for (const id of value) {
        if (!Number.isInteger(id) || id <= 0)
            return invalid('Destination group IDs must be positive integers');
    }
    return VALID;
}

/** Scope must select at least one target across the typed buckets. */
export function validateScopeIsNonEmpty(scope: {
    deviceIds?: readonly string[];
    componentIds?: readonly string[];
    groupIds?: readonly number[];
    locationIds?: readonly number[];
    tagIds?: readonly number[];
}): ValidationResult {
    const total =
        (scope.deviceIds?.length ?? 0) +
        (scope.componentIds?.length ?? 0) +
        (scope.groupIds?.length ?? 0) +
        (scope.locationIds?.length ?? 0) +
        (scope.tagIds?.length ?? 0);
    if (total === 0) return invalid('Pick at least one device, group, or tag');
    return VALID;
}

function validateSecondsInRange(
    value: number | string,
    min: number,
    max: number
): ValidationResult {
    const seconds = typeof value === 'string' ? Number(value) : value;
    if (!Number.isInteger(seconds))
        return invalid('Value must be a whole number of seconds');
    if (seconds < min || seconds > max)
        return invalid(`Value must be between ${min} and ${max} seconds`);
    return VALID;
}
