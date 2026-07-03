// Discovery RPCs — AdmitDevice + ScanLan.

import {
    ADMIT_REBOOT_OPERATION,
    admitDevice
} from '../../modules/discovery/admitDevice';
import {probeHost} from '../../modules/discovery/probeHost';
import {scanLan} from '../../modules/discovery/scanLan';
import {
    classifyByCode,
    rpcErrorCode,
    rpcErrorDetail,
    withOutcomeCounter
} from '../../modules/rpcOutcomeCounter';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import type {DescribeOutput} from '../../types/api/_describe';
import {
    DISCOVERY_ADMIT_DEVICE_PARAMS_SCHEMA,
    DISCOVERY_DESCRIBE,
    DISCOVERY_PROBE_PARAMS_SCHEMA,
    DISCOVERY_SCAN_LAN_PARAMS_SCHEMA,
    type DiscoveryAdmitDeviceParams,
    type DiscoveryAdmitDeviceResult,
    type DiscoveryProbeParams,
    type DiscoveryProbeResult,
    type DiscoveryScanLanParams
} from '../../types/api/discovery';
import {DOMAIN_ERRORS} from '../../types/api/errors';
import type CommandSender from '../CommandSender';
import Component from './Component';

const ADMIT_METRIC = 'discovery_admit_device_total';
const PROBE_METRIC = 'discovery_probe_total';
const SCAN_METRIC = 'discovery_scan_lan_total';

// ServiceUnavailable splits by operation: reboot-time failures land as
// 'reboot_failed', probe-time failures stay 'unreachable'. The split lives
// here because the table-dispatch helper is keyed by code alone.
const UNAUTHORIZED_CODE = -32000;

// Subset of admit's table — no auth/reboot codes since probe never mutates.
const PROBE_OUTCOME_BY_CODE: Record<number, string> = {
    [DOMAIN_ERRORS.OrgScopeRequired.code]: 'unauthorized',
    [DOMAIN_ERRORS.UnsupportedDeviceGen.code]: 'unsupported_gen',
    [DOMAIN_ERRORS.NotAShellyDevice.code]: 'unsupported_gen',
    [DOMAIN_ERRORS.FirmwareTooOld.code]: 'firmware_too_old',
    [DOMAIN_ERRORS.HostNotAllowed.code]: 'host_not_allowed',
    [DOMAIN_ERRORS.ServiceUnavailable.code]: 'unreachable'
};

const classifyProbe = classifyByCode(PROBE_OUTCOME_BY_CODE);

const ADMIT_OUTCOME_BY_CODE: Record<number, string> = {
    [UNAUTHORIZED_CODE]: 'unauthorized',
    [DOMAIN_ERRORS.OrgScopeRequired.code]: 'unauthorized',
    [DOMAIN_ERRORS.AuthRequired.code]: 'auth_required',
    [DOMAIN_ERRORS.AuthFailed.code]: 'auth_required',
    [DOMAIN_ERRORS.UnsupportedDeviceGen.code]: 'unsupported_gen',
    [DOMAIN_ERRORS.NotAShellyDevice.code]: 'unsupported_gen',
    [DOMAIN_ERRORS.FirmwareTooOld.code]: 'firmware_too_old',
    [DOMAIN_ERRORS.HostNotAllowed.code]: 'host_not_allowed'
};

const classifyAdmitByCode = classifyByCode(ADMIT_OUTCOME_BY_CODE);

function classifyAdmit(err: unknown): string {
    if (rpcErrorCode(err) === DOMAIN_ERRORS.ServiceUnavailable.code) {
        return rpcErrorDetail(err, 'operation') === ADMIT_REBOOT_OPERATION
            ? 'reboot_failed'
            : 'unreachable';
    }
    return classifyAdmitByCode(err);
}

const SCAN_OUTCOME_BY_CODE: Record<number, string> = {
    [DOMAIN_ERRORS.ServiceUnavailable.code]: 'mdns_unavailable'
};

const classifyScan = classifyByCode(SCAN_OUTCOME_BY_CODE);

interface Config {
    viewer_visible: boolean;
}

export default class DiscoveryComponent extends Component<Config> {
    constructor() {
        super('discovery', {viewer_visible: false});
    }

    protected override getDefaultConfig(): Config {
        return {viewer_visible: false};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return DISCOVERY_DESCRIBE;
    }

    @Component.Expose('AdmitDevice')
    @Component.AcceptsScopedToken('devices.create')
    @Component.CrudPermission('devices', 'create')
    async admitDevice(
        params: unknown,
        sender: CommandSender
    ): Promise<DiscoveryAdmitDeviceResult> {
        const p = validateOrThrow<DiscoveryAdmitDeviceParams>(
            params,
            DISCOVERY_ADMIT_DEVICE_PARAMS_SCHEMA
        );
        return withOutcomeCounter({
            metric: ADMIT_METRIC,
            classify: classifyAdmit,
            run: () => this.#admitAuthorized(p, sender)
        });
    }

    async #admitAuthorized(
        p: DiscoveryAdmitDeviceParams,
        sender: CommandSender
    ): Promise<DiscoveryAdmitDeviceResult> {
        const organizationId = requireOrganizationId(sender, p);
        const actorId = sender.getUser()?.username;
        if (!actorId) throw RpcError.Unauthorized();
        return admitDevice({
            host: p.host,
            password: p.password,
            groupId: p.groupId,
            organizationId,
            actorId
        });
    }

    @Component.Expose('Probe')
    @Component.AcceptsScopedToken('devices.read')
    @Component.CrudPermission('devices', 'read')
    async probe(
        params: unknown,
        sender: CommandSender
    ): Promise<DiscoveryProbeResult> {
        const p = validateOrThrow<DiscoveryProbeParams>(
            params,
            DISCOVERY_PROBE_PARAMS_SCHEMA
        );
        return withOutcomeCounter({
            metric: PROBE_METRIC,
            classify: classifyProbe,
            run: () => this.#probeAuthorized(p, sender)
        });
    }

    async #probeAuthorized(
        p: DiscoveryProbeParams,
        sender: CommandSender
    ): Promise<DiscoveryProbeResult> {
        const organizationId = requireOrganizationId(sender, p);
        return probeHost({host: p.host, organizationId});
    }

    @Component.Expose('ScanLan')
    @Component.CrudPermission('devices', 'create')
    async scanLan(params: unknown, sender: CommandSender): Promise<unknown> {
        const p = validateOrThrow<DiscoveryScanLanParams>(
            params ?? {},
            DISCOVERY_SCAN_LAN_PARAMS_SCHEMA
        );
        return withOutcomeCounter({
            metric: SCAN_METRIC,
            classify: classifyScan,
            run: () => this.#scanAuthorized(p, sender)
        });
    }

    async #scanAuthorized(
        p: DiscoveryScanLanParams,
        sender: CommandSender
    ): Promise<unknown> {
        const orgId = requireOrganizationId(sender, p);
        return scanLan({orgId, timeoutMs: p.timeoutMs});
    }
}
