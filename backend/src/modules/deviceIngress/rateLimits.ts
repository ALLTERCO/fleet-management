import RpcError from '../../rpc/RpcError';
import {rateLimiter} from '../redis/services';

export interface DeviceIngressRateLimitInput {
    scope: string;
    actor: string;
    capacityPerMinute: number;
}

export async function enforceDeviceIngressRateLimit(
    input: DeviceIngressRateLimitInput
): Promise<void> {
    const allowed = await rateLimiter.consume(
        bucketKey(input),
        input.capacityPerMinute,
        input.capacityPerMinute / 60
    );
    if (allowed) return;
    throw RpcError.Domain('RateLimitExceeded', {
        details: {method: `deviceIngress.${input.scope}`}
    });
}

function bucketKey(input: DeviceIngressRateLimitInput): string {
    return `device-ingress:${input.scope}:${input.actor}`;
}
