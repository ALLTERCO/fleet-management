import {getLogger} from 'log4js';
import {type DeploymentMode, runtimeMetadata} from '../config';
import RpcError from '../rpc/RpcError';
import {getDeploymentTopology} from './identity';
import {zitadelService} from './zitadel';

const logger = getLogger('saas-mode');

interface SaasZitadelOrganizationConfig {
    deploymentMode: DeploymentMode;
    platformOrgId?: string;
    tenantOrgId?: string;
}

export function isSaasMode(): boolean {
    return runtimeMetadata.deploymentMode !== 'oss';
}

export function requireSaasMode(feature?: string): void {
    if (isSaasMode()) return;
    throw RpcError.Unavailable(
        feature ?? 'SaaS-only feature',
        'Available on shared_saas / dedicated_saas builds only.'
    );
}

export function validateSaasZitadelOrganizationConfig({
    deploymentMode,
    platformOrgId,
    tenantOrgId
}: SaasZitadelOrganizationConfig): void {
    if (deploymentMode === 'oss') return;
    if (platformOrgId && tenantOrgId) return;
    if (!tenantOrgId) {
        throw new Error(
            'FM_CLIENT_ORG_ID is required in SaaS mode for tenant pinning.'
        );
    }
    throw new Error(
        'FM_PLATFORM_ORG_ID is required in SaaS mode for provider support authority.'
    );
}

export function assertSaasZitadelOrganizationsConfigured(): void {
    const topology = getDeploymentTopology();
    const platformOrgId = topology.platformOrgId;
    const tenantOrgId = topology.clientOrgId;
    if (platformOrgId) {
        logger.info(
            'provider support org id configured: %s...',
            platformOrgId.slice(0, 8)
        );
    }
    validateSaasZitadelOrganizationConfig({
        deploymentMode: runtimeMetadata.deploymentMode,
        platformOrgId,
        tenantOrgId
    });
}

export function assertSaasZitadelManagementApiConfigured(): void {
    if (!isSaasMode()) return;
    if (zitadelService.isManagementApiAvailable()) return;
    throw new Error(
        'Zitadel Management API auth is required in SaaS mode for provider support authority.'
    );
}
