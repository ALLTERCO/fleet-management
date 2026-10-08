// Which device used the most, over a window.
//
// Attribution answers "why was yesterday expensive" by breaking a window down
// per device. It is a question about a period, not a live reading, so it takes
// an explicit window and never assumes "now".

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type AnalyticsMethod = Extract<HostMethod, `analytics.${string}`>;

export type FleetAnalyticsDomain = ReturnType<typeof createAnalyticsDomain>;

export function createAnalyticsDomain(access: FleetRpcAccess) {
    const analytics = namespaceCaller<AnalyticsMethod>(access);

    return {
        /** Per-device contribution across an explicit time window. */
        attributeWindow: (params: HostParams<'analytics.attributewindow'>) =>
            analytics('analytics.attributewindow', params)
    };
}
