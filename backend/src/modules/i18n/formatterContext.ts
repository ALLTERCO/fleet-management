// Builds the FormatterContext for a request from the caller's organization:
// locale + currency + unit system, all first-class org columns (set via
// organization.SetProfile). Currency falls back to the env default and unit
// system to metric when the org leaves them null. The column constraints
// (^[A-Z]{3}$ currency, metric/imperial unit system) keep the values safe for
// Intl, so no extra validation is needed here.

import {dashboardDefaults} from '../../config/dashboardDefaults';
import type {FormatterContext} from '../../model/report/semanticTypes';
import type {OrganizationProfile} from '../../types/api/organization';
import {getOrganizationProfile} from '../organizationModel';

const DEFAULT_LOCALE = 'en-US';

interface SenderLike {
    getOrganizationId(): string | undefined;
}

// Injectable so the build logic is testable without a database.
export interface FormatterContextLoaders {
    loadProfile(orgId: string): Promise<OrganizationProfile>;
}

const defaultLoaders: FormatterContextLoaders = {
    loadProfile: getOrganizationProfile
};

function fromProfile(profile: OrganizationProfile): FormatterContext {
    return {
        locale: profile.localeDefault ?? DEFAULT_LOCALE,
        currency: profile.currencyDefault ?? dashboardDefaults().currency,
        unitSystem: profile.unitSystemDefault ?? 'metric'
    };
}

function defaultContext(): FormatterContext {
    return {
        locale: DEFAULT_LOCALE,
        currency: dashboardDefaults().currency,
        unitSystem: 'metric'
    };
}

// An unauthenticated / org-less sender gets the env defaults; otherwise the
// org's locale + currency + unit system.
export async function buildFormatterContext(
    sender: SenderLike,
    loaders: FormatterContextLoaders = defaultLoaders
): Promise<FormatterContext> {
    const orgId = sender.getOrganizationId();
    if (!orgId) return defaultContext();
    return fromProfile(await loaders.loadProfile(orgId));
}
