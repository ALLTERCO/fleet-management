import {tuning} from '../../config/tuning';
import RpcError from '../../rpc/RpcError';

// One home for the public device-WS base URL. Every URL we hand out
// (provisioning plans, enrollment links) must fail loud when it is not
// configured — a silently broken link looks like a working feature.
export function requirePublicWsBaseUrl(): string {
    const url = tuning.deviceIngress.publicWsBaseUrl.trim();
    if (url) return url;
    throw RpcError.InvalidParams(
        'FM_DEVICE_INGRESS_PUBLIC_WS_BASE_URL is required'
    );
}
