import {envStr, envStrRequired} from './envReader';

export type DeploymentMode = 'oss' | 'shared_saas' | 'dedicated_saas';

export function readDeploymentMode(): DeploymentMode {
    const mode = parseDeploymentMode(envStrRequired('FM_DEPLOYMENT_MODE'));
    if (mode) return mode;
    throw new Error(
        'Required env var FM_DEPLOYMENT_MODE must be one of: oss, shared_saas, dedicated_saas'
    );
}

// Lenient read for config-default sites (tuning) that must not hard-require
// boot env at module load. Boot itself still fails loud via readDeploymentMode.
export function peekDeploymentMode(): DeploymentMode | null {
    return parseDeploymentMode(envStr('FM_DEPLOYMENT_MODE', ''));
}

function parseDeploymentMode(raw: string): DeploymentMode | null {
    if (raw === 'oss' || raw === 'shared_saas' || raw === 'dedicated_saas') {
        return raw;
    }
    return null;
}
