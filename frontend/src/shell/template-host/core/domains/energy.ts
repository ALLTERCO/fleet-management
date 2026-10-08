// Curated energy: live totals, history, logical meters and topology.
// No per-device fan-out and no client-side summing.

import type {EnergyQueryParams, EnergyQueryResponse} from '@api/energy';
import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

export type FleetEnergyDomain = ReturnType<typeof createEnergyDomain>;

type EnergyMethod = Extract<HostMethod, `energy.${string}`>;

export function createEnergyDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<EnergyMethod>(access);
    return {
        /** `asOf` is the server's answer-assembly time, not a device sample
         *  time — see `HostEnergyCurrentResult` in ../data-contract for the
         *  fallback rule. */
        current(
            params: HostParams<'energy.current'> = {}
        ): Promise<HostResult<'energy.current'>> {
            return call('energy.current', params);
        },
        /** Response stays on `@api/energy`: the contract widens `tag` and
         *  `meta.bucket` to plain `string`, losing the tag union a chart needs. */
        history(params: EnergyQueryParams): Promise<EnergyQueryResponse> {
            return access.rpc<EnergyQueryResponse>('energy.query', params);
        },
        logicalMeters(
            params: HostParams<'energy.listlogicalmeters'> = {}
        ): Promise<HostResult<'energy.listlogicalmeters'>> {
            return call('energy.listlogicalmeters', params);
        },
        meterConnections(): Promise<HostResult<'energy.listmeterconnections'>> {
            return call('energy.listmeterconnections', {});
        },
        /** The raw points a meter can be built from — what the fleet measures
         *  before anyone said what it means. */
        listMeasurementPoints(
            params: HostParams<'energy.listmeasurementpoints'> = {}
        ): Promise<HostResult<'energy.listmeasurementpoints'>> {
            return call('energy.listmeasurementpoints', params);
        },
        saveLogicalMeter(
            params: HostParams<'energy.savelogicalmeter'>
        ): Promise<HostResult<'energy.savelogicalmeter'>> {
            return call('energy.savelogicalmeter', params);
        },
        deleteLogicalMeter(
            params: HostParams<'energy.deletelogicalmeter'>
        ): Promise<HostResult<'energy.deletelogicalmeter'>> {
            return call('energy.deletelogicalmeter', params);
        },
        saveMeterConnection(
            params: HostParams<'energy.savemeterconnection'>
        ): Promise<HostResult<'energy.savemeterconnection'>> {
            return call('energy.savemeterconnection', params);
        },
        deleteMeterConnection(
            params: HostParams<'energy.deletemeterconnection'>
        ): Promise<HostResult<'energy.deletemeterconnection'>> {
            return call('energy.deletemeterconnection', params);
        },
        /** Corrects the electrical domain guessed for one point. A wrong guess
         *  hides the point from every report that filters on domain. */
        setPointOverride(
            params: HostParams<'energy.setpointoverride'>
        ): Promise<HostResult<'energy.setpointoverride'>> {
            return call('energy.setpointoverride', params);
        },
        /** How far behind the history is. A total read while this is catching
         *  up is low, and looks like a real drop. */
        syncStatus(
            params: HostParams<'energy.syncstatus'> = {}
        ): Promise<HostResult<'energy.syncstatus'>> {
            return call('energy.syncstatus', params);
        },
        /** Extrapolated, not measured — `extrapolated` and `confidenceBand`
         *  say how much of this is a guess. */
        projection(
            params: HostParams<'energy.projection'>
        ): Promise<HostResult<'energy.projection'>> {
            return call('energy.projection', params);
        },
        /** The learned normal for one measured device channel and tag. */
        baseline(
            params: HostParams<'energy.baseline'>
        ): Promise<HostResult<'energy.baseline'>> {
            return call('energy.baseline', params);
        },
        /** The estate night draw as one number, so a caller never sums the
         *  168-cell profiles itself. `baselineKw` is null while any meter is
         *  still learning. */
        overnightBaseline(
            params: HostParams<'energy.overnightbaseline'> = {}
        ): Promise<HostResult<'energy.overnightbaseline'>> {
            return call('energy.overnightbaseline', params);
        },
        /** Days deliberately excluded from the organization learned normal. */
        listBaselineExclusions(): Promise<
            HostResult<'energy.listbaselineexclusions'>
        > {
            return call('energy.listbaselineexclusions', {});
        },
        saveBaselineExclusion(
            params: HostParams<'energy.savebaselineexclusion'>
        ): Promise<HostResult<'energy.savebaselineexclusion'>> {
            return call('energy.savebaselineexclusion', params);
        },
        deleteBaselineExclusion(
            params: HostParams<'energy.deletebaselineexclusion'>
        ): Promise<HostResult<'energy.deletebaselineexclusion'>> {
            return call('energy.deletebaselineexclusion', params);
        },
        /** Meter resets, which break a naive last-minus-first delta. */
        getResetAudit(
            params: HostParams<'energy.getresetaudit'> = {}
        ): Promise<HostResult<'energy.getresetaudit'>> {
            return call('energy.getresetaudit', params);
        }
    };
}
