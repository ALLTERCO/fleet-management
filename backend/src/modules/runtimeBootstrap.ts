import fs from 'node:fs';
import path from 'node:path';
import {configRc, DEV_MODE, runtimeMetadata, tuning} from '../config';
import type CommandSender from '../model/CommandSender';
import type {FleetRole} from '../types/api/authzCatalog';
import type {SystemBootstrapResponse} from '../types/api/system';
import {hasTenantAdminAuthority} from './authz/evaluator';
import * as Commander from './Commander';
import {getOrganizationProfile} from './organizationModel';

const BACKEND_PACKAGE_JSON = path.join(process.cwd(), 'package.json');
let backendVersionCache: string | null = null;

function readBackendVersion(): string {
    if (backendVersionCache) return backendVersionCache;
    try {
        const raw = fs.readFileSync(BACKEND_PACKAGE_JSON, 'utf8');
        const parsed = JSON.parse(raw) as {version?: unknown};
        backendVersionCache =
            typeof parsed.version === 'string' ? parsed.version : '0.0.0';
    } catch {
        backendVersionCache = '0.0.0';
    }
    return backendVersionCache;
}

function collectComponentFlags(): Record<string, boolean> {
    return Object.fromEntries(
        Array.from(Commander.getComponents().keys())
            .sort()
            .map((name) => [name, true])
    );
}

export async function buildSystemBootstrap(
    sender: CommandSender
): Promise<SystemBootstrapResponse> {
    const organizationId = sender.getOrganizationId();
    const organization = organizationId
        ? await getOrganizationProfile(organizationId)
        : null;

    return {
        version: 1,
        organization,
        user: {
            username: sender.getUser()?.username ?? null,
            roles: sender.getRoles() as readonly FleetRole[],
            group: sender.getGroup(),
            canWrite: sender.canWrite(),
            isAdmin: hasTenantAdminAuthority(sender),
            isViewer: sender.isViewer(),
            effectiveShape: sender.getEffectiveShape()
        },
        runtime: {
            backendVersion: readBackendVersion(),
            apiContractVersion: runtimeMetadata.apiContractVersion,
            authMode: DEV_MODE ? 'dev' : 'zitadel',
            deploymentMode: runtimeMetadata.deploymentMode,
            safeMode: runtimeMetadata.safeMode,
            frontendArtifact: {
                id: runtimeMetadata.frontendArtifactId,
                version: runtimeMetadata.frontendArtifactVersion,
                uiContractVersion: runtimeMetadata.uiContractVersion
            },
            addons: {
                grafana: Boolean(configRc.graphs?.grafana?.endpoint),
                nodeRed: tuning.nodeRed.enabled
            }
        },
        features: {
            components: collectComponentFlags()
        }
    };
}
