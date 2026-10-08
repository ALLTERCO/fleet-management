import CommandSender from '../../model/CommandSender';
import {mapRolesToPermissions} from '../authz/coarse';
import {
    canPerformComponentOperationAsync,
    isComponentPermissionAllowed
} from '../authz/evaluator';
import {identityDirectory} from '../identity';
import {getActiveScopedPat} from '../user/tokenStore';
import type {JobAuthority} from './repository';

type SystemAuthorityChecker = (
    authority: Extract<JobAuthority, {kind: 'system'}>,
    deviceId: string
) => boolean | Promise<boolean>;

let systemAuthorityChecker: SystemAuthorityChecker | null = null;

const defaultAuthorityDependencies = {
    userAccountActive: (userId: string) =>
        identityDirectory.userAccountActive(userId),
    userBelongsToTenant: (query: {userId: string; tenantId: string}) =>
        identityDirectory.userBelongsToTenant(query),
    getProjectRoles: (query: {userId: string; organizationId?: string}) =>
        identityDirectory.getProjectRoles(query),
    getActiveScopedPat
};
let authorityDependencies = defaultAuthorityDependencies;

export function __setJobAuthorityDependenciesForTests(
    dependencies: Partial<typeof defaultAuthorityDependencies> | null
): void {
    authorityDependencies = dependencies
        ? {...defaultAuthorityDependencies, ...dependencies}
        : defaultAuthorityDependencies;
}

export function registerSystemJobAuthorityChecker(
    checker: SystemAuthorityChecker
): void {
    systemAuthorityChecker = checker;
}

export function snapshotJobAuthority(
    sender: CommandSender,
    tenantId: string,
    operation: 'update' | 'execute'
): Extract<JobAuthority, {kind: 'user'}> {
    const userId = sender.getUserId();
    if (!userId || sender.isTrusted()) {
        throw new Error(
            'A persistent job requires an authenticated user authority'
        );
    }
    return {
        kind: 'user',
        tenantId,
        userId,
        username: sender.getUser()?.username,
        credentialId: sender.getCredentialId(),
        credentialBoundary: sender.getCredentialBoundary(),
        operation,
        sourceIp: sender.getSourceIp()
    };
}

export function firmwareAutoUpdateAuthority(
    tenantId: string,
    channel: 'stable' | 'beta'
): JobAuthority {
    return {kind: 'system', tenantId, service: 'firmware-auto-update', channel};
}

export async function restoreCurrentUserAuthority(
    authority: Extract<JobAuthority, {kind: 'user'}>
): Promise<CommandSender | null> {
    if (!(await authorityDependencies.userAccountActive(authority.userId))) {
        return null;
    }
    if (
        !(await authorityDependencies.userBelongsToTenant({
            userId: authority.userId,
            tenantId: authority.tenantId
        }))
    ) {
        return null;
    }
    const roles = await authorityDependencies.getProjectRoles({
        userId: authority.userId,
        organizationId: authority.tenantId
    });
    const mapped = mapRolesToPermissions(roles.roles);
    let credentialBoundary = authority.credentialBoundary;
    if (authority.credentialId) {
        const credential = await authorityDependencies.getActiveScopedPat(
            authority.credentialId
        );
        if (
            !credential ||
            credential.tenantId !== authority.tenantId ||
            credential.userId !== authority.userId
        ) {
            return null;
        }
        credentialBoundary = credential.boundaryScope;
    }
    const sender = new CommandSender({
        permissions: mapped.permissions,
        roles: roles.roles,
        username: authority.username,
        userId: authority.userId,
        organizationId: authority.tenantId,
        credentialId: authority.credentialId,
        credentialBoundary,
        mfaPresent: false,
        sourceIp: authority.sourceIp,
        principalType: authority.credentialId ? 'service_user' : 'user'
    });
    await sender.loadV2EffectiveShape();
    return sender;
}

export async function jobAuthorityAllowsDispatch(
    authority: JobAuthority,
    tenantId: string,
    deviceId: string
): Promise<boolean> {
    try {
        if (authority.tenantId !== tenantId) return false;
        if (authority.kind === 'system') {
            return (
                authority.service === 'firmware-auto-update' &&
                systemAuthorityChecker !== null &&
                (await systemAuthorityChecker(authority, deviceId))
            );
        }
        const sender = await restoreCurrentUserAuthority(authority);
        if (!sender) return false;
        return isComponentPermissionAllowed(
            await canPerformComponentOperationAsync(
                sender,
                'devices',
                authority.operation,
                deviceId
            )
        );
    } catch {
        return false;
    }
}

export async function jobAuthorityAllowsAllTargets(
    authority: JobAuthority,
    tenantId: string,
    deviceIds: readonly string[]
): Promise<boolean> {
    for (const deviceId of deviceIds) {
        if (
            !(await jobAuthorityAllowsDispatch(authority, tenantId, deviceId))
        ) {
            return false;
        }
    }
    return deviceIds.length > 0;
}
