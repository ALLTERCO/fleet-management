import {readAppVersion} from './appVersion';
import {type DeploymentMode, readDeploymentMode} from './deploymentMode';
import {envBoolRequired, envStr, envStrRequired} from './envReader';

export type {DeploymentMode};

export interface RuntimeMetadataConfig {
    apiContractVersion: string;
    uiContractVersion: string;
    frontendArtifactId: string;
    frontendArtifactVersion: string;
    deploymentMode: DeploymentMode;
    topologyMode: string;
    clientId: string;
    environmentId: string;
    composeProject: string;
    managedBy: string;
    safeMode: boolean;
    /** Short SHA injected by deploy script; empty when not set. */
    buildCommit: string;
}

export function resolveFrontendArtifactVersion(
    configuredVersion: string,
    appVersion = readAppVersion()
): string {
    return configuredVersion === 'default' ? appVersion : configuredVersion;
}

export function readRuntimeMetadata(): RuntimeMetadataConfig {
    const configuredFrontendVersion = envStrRequired(
        'FM_FRONTEND_ARTIFACT_VERSION'
    );
    return {
        apiContractVersion: envStrRequired('FM_API_CONTRACT_VERSION'),
        uiContractVersion: envStrRequired('FM_UI_CONTRACT_VERSION'),
        frontendArtifactId: envStrRequired('FM_FRONTEND_ARTIFACT_ID'),
        frontendArtifactVersion: resolveFrontendArtifactVersion(
            configuredFrontendVersion
        ),
        deploymentMode: readDeploymentMode(),
        topologyMode: envStr('FM_TOPOLOGY_MODE', 'unknown'),
        clientId: envStr('FM_CLIENT_ID', 'unknown'),
        environmentId: envStr(
            'FM_ENVIRONMENT_ID',
            envStr('ENV_NAME', 'unknown')
        ),
        composeProject: envStr(
            'FM_COMPOSE_PROJECT_NAME',
            envStr('COMPOSE_PROJECT_NAME', 'unknown')
        ),
        managedBy: envStr('FM_MANAGED_BY', 'fleet-manager'),
        safeMode: envBoolRequired('FM_SAFE_MODE'),
        buildCommit: envStr('FM_BUILD_COMMIT', '')
    };
}

export const runtimeMetadata = Object.freeze(readRuntimeMetadata());
