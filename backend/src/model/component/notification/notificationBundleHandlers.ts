// Notification bundle validate/plan/apply plus native and external
// (Grafana / Alertmanager) import/export adapters.

import {listOnCallSchedules} from '../../../modules/notification/OnCallScheduleStore';
import {listRoutingPolicies} from '../../../modules/notification/RoutingPolicyStore';
import {
    exportAlertmanagerConfig,
    importAlertmanagerConfig
} from '../../../modules/notificationBundle/adapters/alertmanager';
import {
    exportGrafanaProvisioning,
    importGrafanaProvisioning
} from '../../../modules/notificationBundle/adapters/grafana';
import {applyNotificationBundleImport} from '../../../modules/notificationBundle/applyImport';
import {listBundleChannels} from '../../../modules/notificationBundle/channelModel';
import {exportNotificationBundle} from '../../../modules/notificationBundle/exportNative';
import {planNotificationBundleImport} from '../../../modules/notificationBundle/planImport';
import {validateNotificationBundle} from '../../../modules/notificationBundle/schema';
import {collectVirtualBundleSelectors} from '../../../modules/notificationBundle/virtualSelectors';
import {mapImportedVirtualAlertSubject} from '../../../modules/virtualDeviceAlerts';
import {requireOrganizationId} from '../../../rpc/scope';
import {validateOrThrow} from '../../../rpc/validateOrThrow';
import {
    NOTIFICATION_BUNDLE_EXPORT_PARAMS_SCHEMA,
    NOTIFICATION_BUNDLE_IMPORT_EXTERNAL_PARAMS_SCHEMA,
    NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA
} from '../../../types/api/notification';
import type CommandSender from '../../CommandSender';

async function resolveVirtualSubjectMappings(
    organizationId: string,
    bundleInput: unknown
) {
    const bundle = validateNotificationBundle(bundleInput);
    const selectors = collectVirtualBundleSelectors(bundle);
    const uniqueSelectors = new Map(
        selectors.map((selector) => [selector.key, selector])
    );
    const entries = await Promise.all(
        [...uniqueSelectors.values()].map(async (selector) => [
            selector.key,
            await mapImportedVirtualAlertSubject({
                organizationId,
                deviceExternalId: selector.deviceExternalId,
                roleKey: selector.roleKey
            })
        ])
    );
    return Object.fromEntries(entries);
}

export async function validateBundle(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        bundle: unknown;
    }>(params, NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA);
    requireOrganizationId(sender, p);

    return {
        dryRun: true,
        bundle: validateNotificationBundle(p.bundle),
        warnings: []
    };
}

export async function planBundleImport(params: unknown, sender: CommandSender) {
    const p = validateOrThrow<{
        organizationId?: string;
        bundle: unknown;
        channelMappings?: Record<string, number>;
    }>(params, NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const [existingChannels, existingRoutingPolicies, existingOnCallSchedules] =
        await Promise.all([
            listBundleChannels({organizationId: orgId}),
            listRoutingPolicies({
                organizationId: orgId,
                enabledOnly: false
            }),
            listOnCallSchedules({organizationId: orgId, enabledOnly: false})
        ]);
    const virtualSubjectMappings = await resolveVirtualSubjectMappings(
        orgId,
        p.bundle
    );
    const planned = planNotificationBundleImport({
        bundle: p.bundle,
        existingChannels,
        existingRoutingPolicies,
        existingOnCallSchedules,
        channelMappings: p.channelMappings,
        virtualSubjectMappings
    });

    return {dryRun: true, ...planned};
}

export async function applyBundleImport(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
        bundle: unknown;
        channelMappings?: Record<string, number>;
    }>(params, NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const [existingChannels, existingRoutingPolicies, existingOnCallSchedules] =
        await Promise.all([
            listBundleChannels({organizationId: orgId}),
            listRoutingPolicies({
                organizationId: orgId,
                enabledOnly: false
            }),
            listOnCallSchedules({organizationId: orgId, enabledOnly: false})
        ]);
    const virtualSubjectMappings = await resolveVirtualSubjectMappings(
        orgId,
        p.bundle
    );
    const applied = await applyNotificationBundleImport({
        organizationId: orgId,
        bundle: p.bundle,
        existingChannels,
        existingRoutingPolicies,
        existingOnCallSchedules,
        channelMappings: p.channelMappings ?? {},
        virtualSubjectMappings
    });

    return {dryRun: false, ...applied};
}

export async function exportNativeBundle(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
    }>(params, NOTIFICATION_BUNDLE_EXPORT_PARAMS_SCHEMA);
    const orgId = requireOrganizationId(sender, p);
    const [channels, routingPolicies, onCallSchedules] = await Promise.all([
        listBundleChannels({organizationId: orgId}),
        listRoutingPolicies({
            organizationId: orgId,
            enabledOnly: false
        }),
        listOnCallSchedules({organizationId: orgId, enabledOnly: false})
    ]);

    return {
        dryRun: true,
        bundle: exportNotificationBundle({
            channels,
            routingPolicies,
            onCallSchedules
        }),
        warnings: []
    };
}

export async function importGrafanaBundle(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
        config: unknown;
    }>(params, NOTIFICATION_BUNDLE_IMPORT_EXTERNAL_PARAMS_SCHEMA);
    requireOrganizationId(sender, p);

    return {dryRun: true, ...importGrafanaProvisioning(p.config)};
}

export async function importAlertmanagerBundle(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
        config: unknown;
    }>(params, NOTIFICATION_BUNDLE_IMPORT_EXTERNAL_PARAMS_SCHEMA);
    requireOrganizationId(sender, p);

    return {dryRun: true, ...importAlertmanagerConfig(p.config)};
}

export async function exportGrafanaBundle(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
        bundle: unknown;
    }>(params, NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA);
    requireOrganizationId(sender, p);

    return {dryRun: true, ...exportGrafanaProvisioning(p.bundle)};
}

export async function exportAlertmanagerBundle(
    params: unknown,
    sender: CommandSender
) {
    const p = validateOrThrow<{
        organizationId?: string;
        bundle: unknown;
    }>(params, NOTIFICATION_BUNDLE_VALIDATE_PARAMS_SCHEMA);
    requireOrganizationId(sender, p);

    return {dryRun: true, ...exportAlertmanagerConfig(p.bundle)};
}
