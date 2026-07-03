import {
    fmClientOrgId,
    fmPlatformOrgId,
    zitadelClientProjectId,
    zitadelDefaultOrgId,
    zitadelProjectName
} from '../../config/zitadel';

export interface DeploymentTopology {
    rootOrgId?: string;
    platformOrgId?: string;
    clientOrgId?: string;
    deploymentRoleScopeId?: string;
    deploymentRoleScopeName: string;
}

export function getDeploymentTopology(): DeploymentTopology {
    return {
        rootOrgId: zitadelDefaultOrgId(),
        platformOrgId: fmPlatformOrgId(),
        clientOrgId: fmClientOrgId(),
        deploymentRoleScopeId: zitadelClientProjectId(),
        deploymentRoleScopeName: zitadelProjectName()
    };
}
