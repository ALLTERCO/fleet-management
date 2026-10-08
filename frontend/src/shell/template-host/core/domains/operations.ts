import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {namespaceCaller} from '../namespace-caller';
import type {FleetRpcAccess} from '../types';

type OperationsMethod = Extract<HostMethod, `operations.${string}`>;

export function createOperationsDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<OperationsMethod>(access);
    return {
        policyRegistry(
            params: HostParams<'operations.getpolicyregistry'> = {}
        ): Promise<HostResult<'operations.getpolicyregistry'>> {
            return call('operations.getpolicyregistry', params);
        },
        policies(
            params: HostParams<'operations.getpolicies'> = {}
        ): Promise<HostResult<'operations.getpolicies'>> {
            return call('operations.getpolicies', params);
        },
        refrigerationPeerHealth(
            params: HostParams<'operations.getrefrigerationpeerhealth'>
        ): Promise<HostResult<'operations.getrefrigerationpeerhealth'>> {
            return call('operations.getrefrigerationpeerhealth', params);
        },
        coldChainRecordVerdict(
            params: HostParams<'operations.getcoldchainrecordverdict'>
        ): Promise<HostResult<'operations.getcoldchainrecordverdict'>> {
            return call('operations.getcoldchainrecordverdict', params);
        },
        parkingOperationalVerdict(
            params: HostParams<'operations.getparkingoperationalverdict'>
        ): Promise<HostResult<'operations.getparkingoperationalverdict'>> {
            return call('operations.getparkingoperationalverdict', params);
        },
        irrigationVerdict(
            params: HostParams<'operations.getirrigationverdict'>
        ): Promise<HostResult<'operations.getirrigationverdict'>> {
            return call('operations.getirrigationverdict', params);
        },
        pvHealthVerdict(
            params: HostParams<'operations.getpvhealthverdict'>
        ): Promise<HostResult<'operations.getpvhealthverdict'>> {
            return call('operations.getpvhealthverdict', params);
        },
        italiaHotWaterVerdict(
            params: HostParams<'operations.getitaliahotwaterverdict'>
        ): Promise<HostResult<'operations.getitaliahotwaterverdict'>> {
            return call('operations.getitaliahotwaterverdict', params);
        },
        italiaPoolRegister(
            params: HostParams<'operations.getitaliapoolregister'>
        ): Promise<HostResult<'operations.getitaliapoolregister'>> {
            return call('operations.getitaliapoolregister', params);
        },
        italiaReopeningFlushVerdict(
            params: HostParams<'operations.getitaliareopeningflushverdict'>
        ): Promise<HostResult<'operations.getitaliareopeningflushverdict'>> {
            return call('operations.getitaliareopeningflushverdict', params);
        },
        italiaNightFlowVerdicts(
            params: HostParams<'operations.getitalianightflowverdicts'>
        ): Promise<HostResult<'operations.getitalianightflowverdicts'>> {
            return call('operations.getitalianightflowverdicts', params);
        },
        italiaPitchVerdict(
            params: HostParams<'operations.getitaliapitchverdict'>
        ): Promise<HostResult<'operations.getitaliapitchverdict'>> {
            return call('operations.getitaliapitchverdict', params);
        },
        italiaSitePowerVerdict(
            params: HostParams<'operations.getitaliasitepowerverdict'>
        ): Promise<HostResult<'operations.getitaliasitepowerverdict'>> {
            return call('operations.getitaliasitepowerverdict', params);
        },
        italiaBreakerTripVerdict(
            params: HostParams<'operations.getitaliabreakertripverdict'>
        ): Promise<HostResult<'operations.getitaliabreakertripverdict'>> {
            return call('operations.getitaliabreakertripverdict', params);
        },
        setRefrigerationPeerPolicy(
            params: HostParams<'operations.setrefrigerationpeerpolicy'>
        ): Promise<HostResult<'operations.setrefrigerationpeerpolicy'>> {
            return call('operations.setrefrigerationpeerpolicy', params);
        },
        setColdChainRecordPolicy(
            params: HostParams<'operations.setcoldchainrecordpolicy'>
        ): Promise<HostResult<'operations.setcoldchainrecordpolicy'>> {
            return call('operations.setcoldchainrecordpolicy', params);
        },
        setParkingOperationalPolicy(
            params: HostParams<'operations.setparkingoperationalpolicy'>
        ): Promise<HostResult<'operations.setparkingoperationalpolicy'>> {
            return call('operations.setparkingoperationalpolicy', params);
        },
        setIrrigationPolicy(
            params: HostParams<'operations.setirrigationpolicy'>
        ): Promise<HostResult<'operations.setirrigationpolicy'>> {
            return call('operations.setirrigationpolicy', params);
        },
        setPvHealthPolicy(
            params: HostParams<'operations.setpvhealthpolicy'>
        ): Promise<HostResult<'operations.setpvhealthpolicy'>> {
            return call('operations.setpvhealthpolicy', params);
        },
        setItaliaHotWaterPolicy(
            params: HostParams<'operations.setitaliahotwaterpolicy'>
        ): Promise<HostResult<'operations.setitaliahotwaterpolicy'>> {
            return call('operations.setitaliahotwaterpolicy', params);
        },
        setItaliaPoolChemistryPolicy(
            params: HostParams<'operations.setitaliapoolchemistrypolicy'>
        ): Promise<HostResult<'operations.setitaliapoolchemistrypolicy'>> {
            return call('operations.setitaliapoolchemistrypolicy', params);
        },
        setItaliaPoolRegisterEntry(
            params: HostParams<'operations.setitaliapoolregisterentry'>
        ): Promise<HostResult<'operations.setitaliapoolregisterentry'>> {
            return call('operations.setitaliapoolregisterentry', params);
        },
        deleteItaliaPoolRegisterEntry(
            params: HostParams<'operations.deleteitaliapoolregisterentry'>
        ): Promise<HostResult<'operations.deleteitaliapoolregisterentry'>> {
            return call('operations.deleteitaliapoolregisterentry', params);
        },
        setItaliaNightFlowPolicy(
            params: HostParams<'operations.setitalianightflowpolicy'>
        ): Promise<HostResult<'operations.setitalianightflowpolicy'>> {
            return call('operations.setitalianightflowpolicy', params);
        },
        setItaliaPitchPolicy(
            params: HostParams<'operations.setitaliapitchpolicy'>
        ): Promise<HostResult<'operations.setitaliapitchpolicy'>> {
            return call('operations.setitaliapitchpolicy', params);
        },
        setItaliaSitePowerPolicy(
            params: HostParams<'operations.setitaliasitepowerpolicy'>
        ): Promise<HostResult<'operations.setitaliasitepowerpolicy'>> {
            return call('operations.setitaliasitepowerpolicy', params);
        },
        setItaliaBreakerTripPolicy(
            params: HostParams<'operations.setitaliabreakertrippolicy'>
        ): Promise<HostResult<'operations.setitaliabreakertrippolicy'>> {
            return call('operations.setitaliabreakertrippolicy', params);
        },
        deletePolicy(
            params: HostParams<'operations.deletepolicy'>
        ): Promise<HostResult<'operations.deletepolicy'>> {
            return call('operations.deletepolicy', params);
        }
    };
}

export type FleetOperationsDomain = ReturnType<typeof createOperationsDomain>;
