// TLS material, and getting it onto devices.
//
// The dangerous verb is `pushToDevices`: a bad certificate reaching a fleet
// takes those devices off the network, and they cannot be reached to fix it.
// That is why `preflightPush` exists and why it is named first here — check,
// then push, then watch `pushStatus`.

import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type CertificateMethod = Extract<HostMethod, `certificate.${string}`>;

export type FleetCertificatesDomain = ReturnType<
    typeof createCertificatesDomain
>;

export function createCertificatesDomain(access: FleetRpcAccess) {
    const certificate = namespaceCaller<CertificateMethod>(access);

    return {
        list: (params: HostParams<'certificate.list'> = {}) =>
            certificate('certificate.list', params),
        get: (params: HostParams<'certificate.get'>) =>
            certificate('certificate.get', params),
        import: (params: HostParams<'certificate.import'>) =>
            certificate('certificate.import', params),
        export: (params: HostParams<'certificate.export'>) =>
            certificate('certificate.export', params),
        /** Renames the stored certificate. It cannot change the material. */
        update: (params: HostParams<'certificate.update'>) =>
            certificate('certificate.update', params),
        delete: (params: HostParams<'certificate.delete'>) =>
            certificate('certificate.delete', params),
        /** Signs a CSR with the fleet CA — the private key stays where it was
         *  generated and never reaches Fleet. */
        signCsr: (params: HostParams<'certificate.signcsr'>) =>
            certificate('certificate.signcsr', params),
        issueDefaults: (
            params: HostParams<'certificate.getissuedefaults'> = {}
        ) => certificate('certificate.getissuedefaults', params),
        issueDeviceCert: (params: HostParams<'certificate.issuedevicecert'>) =>
            certificate('certificate.issuedevicecert', params),
        /** Check BEFORE pushing. A bad cert takes devices off the network and
         *  they cannot be reached to undo it. */
        preflightPush: (params: HostParams<'certificate.preflightpush'>) =>
            certificate('certificate.preflightpush', params),
        pushToDevices: (params: HostParams<'certificate.pushtodevices'>) =>
            certificate('certificate.pushtodevices', params),
        pushes: (params: HostParams<'certificate.listpushes'> = {}) =>
            certificate('certificate.listpushes', params),
        pushStatus: (params: HostParams<'certificate.pushstatus'>) =>
            certificate('certificate.pushstatus', params),
        scope: {
            setGroups: (params: HostParams<'certificate.setgroups'>) =>
                certificate('certificate.setgroups', params),
            setTags: (params: HostParams<'certificate.settags'>) =>
                certificate('certificate.settags', params)
        }
    };
}
