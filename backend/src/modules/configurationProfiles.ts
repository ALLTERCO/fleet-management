import type CommandSender from '../model/CommandSender';
import type {CrudOperation} from '../model/permissions';
import {
    canPerformComponentOperation,
    isComponentPermissionAllowed,
    requireComponentPermission
} from './authz/evaluator';
import * as Registry from './Registry';

export type ConfigurationProfiles = Record<
    string,
    Record<string, Record<string, unknown>>
>;

export function requireConfigurationProfileAccess(
    sender: CommandSender,
    profileKey: string,
    operation: CrudOperation
): void {
    requireComponentPermission(sender, 'configurations', operation, profileKey);
}

export function filterReadableConfigurationProfiles(
    sender: CommandSender,
    profiles: ConfigurationProfiles
): ConfigurationProfiles {
    return Object.fromEntries(
        Object.entries(profiles).filter(([profileKey]) =>
            isComponentPermissionAllowed(
                canPerformComponentOperation(
                    sender,
                    'configurations',
                    'read',
                    profileKey
                )
            )
        )
    );
}

export async function readReadableConfigurationProfiles(
    sender: CommandSender
): Promise<ConfigurationProfiles> {
    requireComponentPermission(sender, 'configurations', 'read');
    const profiles = (await Registry.getAll(
        'configs'
    )) as ConfigurationProfiles;
    return filterReadableConfigurationProfiles(sender, profiles);
}

export async function readConfigurationProfile(
    sender: CommandSender,
    profileKey: string
): Promise<unknown> {
    requireConfigurationProfileAccess(sender, profileKey, 'read');
    return Registry.getFromRegistry(
        'configs',
        profileKey,
        sender.getOrganizationId()
    );
}

export async function listReadableConfigurationProfileKeys(
    sender: CommandSender
): Promise<string[]> {
    return Object.keys(await readReadableConfigurationProfiles(sender));
}
