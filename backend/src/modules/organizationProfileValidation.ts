// Semantic validation for the organization profile patch — the JSON schema only
// bounds type/length, so IANA timezone + BCP-47 locale are checked here. Keeps
// report/format code downstream from choking on a junk timezone or locale.

import RpcError from '../rpc/RpcError';
import {isValidTimezone} from './location/isoData';

function isValidLocale(value: string): boolean {
    try {
        return Intl.getCanonicalLocales(value).length > 0;
    } catch {
        return false;
    }
}

export function assertValidProfilePatch(patch: {
    timezoneDefault?: string | null;
    localeDefault?: string | null;
    metadata?: Record<string, unknown>;
}): void {
    if (
        patch.metadata &&
        Object.hasOwn(patch.metadata, 'operationalVerdictPolicies')
    ) {
        throw RpcError.InvalidParams(
            'Operational policies must be changed through Operations methods'
        );
    }
    if (
        typeof patch.timezoneDefault === 'string' &&
        !isValidTimezone(patch.timezoneDefault)
    ) {
        throw RpcError.InvalidParams(
            `Unknown timezone '${patch.timezoneDefault}'`
        );
    }
    if (
        typeof patch.localeDefault === 'string' &&
        !isValidLocale(patch.localeDefault)
    ) {
        throw RpcError.InvalidParams(`Invalid locale '${patch.localeDefault}'`);
    }
}
