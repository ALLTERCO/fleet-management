/**
 * Notification namespace — push-notification (mobile / web push) token
 * registry. Distinct from System.Subscribe / Unsubscribe, which are
 * per-connection WebSocket lifecycle hooks; this manages the persisted
 * token table instead.
 *
 * Permissions:
 *   - Subscribe is @ReadOnly but requires an authenticated caller
 *     (non-empty username). Tokens are bound to the caller's user_id at
 *     insert time; the unique constraint is (token, user_id), so a
 *     different user re-registering a token inserts a new row rather
 *     than hijacking the existing one.
 *   - ListTokens requires admin (enumerates every token across users).
 */

import {
    canPerformComponentOperationAsync,
    canUseAuthenticatedRead,
    canUsePlatformAdmin,
    isComponentPermissionAllowed,
    requireComponentPermissionAsync,
    requireTenantWideComponentPermission
} from '../../modules/authz/evaluator';
import type {DescribeOutput} from '../../rpc/describe';
import {requireOrganizationId} from '../../rpc/scope';
import {
    type DeliveryJob,
    type DestinationGroup,
    type DestinationModel,
    NOTIFICATION_DESCRIBE
} from '../../types/api/notification';
import type CommandSender from '../CommandSender';
import {requireAlertReadable} from './AlertComponent';
import Component from './Component';
import * as AssetHandlers from './notification/notificationAssetHandlers';
import * as BundleHandlers from './notification/notificationBundleHandlers';
import * as ChannelHandlers from './notification/notificationChannelHandlers';
import * as DestinationHandlers from './notification/notificationDestinationHandlers';
import * as EmailTemplateHandlers from './notification/notificationEmailTemplateHandlers';
import * as HistoryHandlers from './notification/notificationHistoryHandlers';
import * as InboxHandlers from './notification/notificationInboxHandlers';
import * as MessageTemplateHandlers from './notification/notificationMessageTemplateHandlers';
import * as RoutingHandlers from './notification/notificationRoutingHandlers';

// The `notification` authz resource is a destination group. Inbox item,
// delivery job, template and asset ids are not group ids, so these methods
// check the grant alone.
// Inbox read state is the caller's own data: reading the inbox allows it.
const NOT_A_DESTINATION_GROUP_ID = (): undefined => undefined;

// Delivery jobs, templates and email assets belong to the whole tenant; no
// scope selector names them, so a grant narrowed to some groups never reaches one.
function requireTenantWideNotificationGrant(
    sender: CommandSender,
    operation: 'read' | 'update' | 'delete'
): Promise<void> {
    return requireTenantWideComponentPermission(
        sender,
        'notifications',
        operation
    );
}

interface PreviewSources {
    organizationId?: string;
    sampleAlertId?: unknown;
    channelId?: unknown;
    emailTemplateId?: unknown;
}

// A preview may load a real alert, a channel's templates or a library
// template; each is checked as the resource it is before the preview reads it.
async function requirePreviewSourcesReadable(
    sender: CommandSender,
    params: unknown
): Promise<void> {
    const p = (params ?? {}) as PreviewSources;
    if (typeof p.sampleAlertId === 'number') {
        await requireAlertReadable(
            sender,
            requireOrganizationId(sender, p),
            p.sampleAlertId
        );
    }
    if (typeof p.channelId === 'number') {
        await requireComponentPermissionAsync(
            sender,
            'integrations',
            'read',
            p.channelId
        );
    }
    if (typeof p.emailTemplateId === 'number') {
        await requireTenantWideNotificationGrant(sender, 'read');
    }
}

export default class NotificationComponent extends Component {
    constructor() {
        super('notification', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return NOTIFICATION_DESCRIBE;
    }

    @Component.Expose('Subscribe')
    @Component.Alias('fleetmanager.subscribetonotifications')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    async subscribe(rawParams: unknown, sender: CommandSender) {
        return InboxHandlers.subscribe(rawParams, sender);
    }

    // get_all_tokens returns every user's push token across every tenant
    // with no scope filter — provider support only.
    @Component.Expose('ListTokens')
    @Component.Alias('fleetmanager.listnotificationtokens')
    @Component.CheckPermissions(canUsePlatformAdmin)
    async listTokens(params: unknown) {
        return InboxHandlers.listTokens(params);
    }

    @Component.NoAudit
    @Component.Expose('Inbox.List')
    @Component.CrudPermission('notifications', 'read')
    async listInbox(params: unknown, sender: CommandSender) {
        return InboxHandlers.listInbox(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('Inbox.Get')
    @Component.CrudPermission(
        'notifications',
        'read',
        NOT_A_DESTINATION_GROUP_ID
    )
    async getInbox(params: unknown, sender: CommandSender) {
        return InboxHandlers.getInbox(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('Inbox.GetMany')
    @Component.CrudPermission(
        'notifications',
        'read',
        NOT_A_DESTINATION_GROUP_ID
    )
    async getInboxMany(params: unknown, sender: CommandSender) {
        return InboxHandlers.getInboxMany(params, sender);
    }

    @Component.Expose('Inbox.MarkRead')
    @Component.CrudPermission(
        'notifications',
        'read',
        NOT_A_DESTINATION_GROUP_ID
    )
    async markInboxRead(params: unknown, sender: CommandSender) {
        return InboxHandlers.markInboxRead(params, sender);
    }

    @Component.Expose('Inbox.MarkUnread')
    @Component.CrudPermission(
        'notifications',
        'read',
        NOT_A_DESTINATION_GROUP_ID
    )
    async markInboxUnread(params: unknown, sender: CommandSender) {
        return InboxHandlers.markInboxUnread(params, sender);
    }

    @Component.Expose('Inbox.MarkAllRead')
    @Component.CrudPermission('notifications', 'read')
    async markAllInboxRead(params: unknown, sender: CommandSender) {
        return InboxHandlers.markAllInboxRead(params, sender);
    }

    // --- Destinations ----------------------------------------------------

    @Component.NoAudit
    @Component.Expose('Destination.GetModel')
    @Component.CrudPermission('notifications', 'read')
    destinationGetModel(params: unknown): DestinationModel {
        return DestinationHandlers.destinationGetModel(params);
    }

    @Component.NoAudit
    @Component.Expose('Destination.List')
    @Component.CrudPermission('notifications', 'read')
    async destinationList(params: unknown, sender: CommandSender) {
        return DestinationHandlers.destinationList(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('Destination.Get')
    @Component.CrudPermission('notifications', 'read')
    async destinationGet(
        params: unknown,
        sender: CommandSender
    ): Promise<DestinationGroup> {
        return DestinationHandlers.destinationGet(params, sender);
    }

    @Component.Expose('Destination.Create')
    @Component.CrudPermission('notifications', 'create')
    async destinationCreate(
        params: unknown,
        sender: CommandSender
    ): Promise<DestinationGroup> {
        return DestinationHandlers.destinationCreate(params, sender);
    }

    @Component.Expose('Destination.Update')
    @Component.CrudPermission('notifications', 'update', (p) => p?.id)
    async destinationUpdate(
        params: unknown,
        sender: CommandSender
    ): Promise<DestinationGroup> {
        return DestinationHandlers.destinationUpdate(params, sender);
    }

    @Component.Expose('Destination.Delete')
    @Component.CrudPermission('notifications', 'delete', (p) => p?.id)
    async destinationDelete(params: unknown, sender: CommandSender) {
        return DestinationHandlers.destinationDelete(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('Destination.ListMembers')
    @Component.CrudPermission('notifications', 'read', (p) => p?.id)
    async destinationListMembers(params: unknown, sender: CommandSender) {
        return DestinationHandlers.destinationListMembers(params, sender);
    }

    @Component.Expose('Destination.AddMembers')
    @Component.CrudPermission('notifications', 'update', (p) => p?.id)
    async destinationAddMembers(params: unknown, sender: CommandSender) {
        return DestinationHandlers.destinationAddMembers(params, sender);
    }

    @Component.Expose('Destination.RemoveMembers')
    @Component.CrudPermission('notifications', 'update', (p) => p?.id)
    async destinationRemoveMembers(params: unknown, sender: CommandSender) {
        return DestinationHandlers.destinationRemoveMembers(params, sender);
    }

    // --- Delivery history ------------------------------------------------

    @Component.NoAudit
    @Component.Expose('History.List')
    @Component.CrudPermission('notifications', 'read')
    async historyList(params: unknown, sender: CommandSender) {
        await requireTenantWideNotificationGrant(sender, 'read');
        return HistoryHandlers.historyList(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('History.Get')
    @Component.CrudPermission(
        'notifications',
        'read',
        NOT_A_DESTINATION_GROUP_ID
    )
    async historyGet(params: unknown, sender: CommandSender) {
        await requireTenantWideNotificationGrant(sender, 'read');
        return HistoryHandlers.historyGet(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('RenderTemplate')
    @Component.CrudPermission('notifications', 'read')
    async renderTemplateRpc(params: unknown, sender: CommandSender) {
        await requirePreviewSourcesReadable(sender, params);
        return ChannelHandlers.renderTemplateRpc(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('RenderEmailPreview')
    @Component.CrudPermission('notifications', 'read')
    async renderEmailPreview(params: unknown, sender: CommandSender) {
        await requirePreviewSourcesReadable(sender, params);
        return ChannelHandlers.renderEmailPreview(params, sender);
    }

    @Component.Expose('Bundle.Validate')
    @Component.CrudPermission('notifications', 'read')
    async validateBundle(params: unknown, sender: CommandSender) {
        return BundleHandlers.validateBundle(params, sender);
    }

    @Component.Expose('Bundle.PlanImport')
    @Component.CrudPermission('notifications', 'read')
    async planBundleImport(params: unknown, sender: CommandSender) {
        return BundleHandlers.planBundleImport(params, sender);
    }

    @Component.Expose('Bundle.ApplyImport')
    @Component.CrudPermission('notifications', 'update')
    async applyBundleImport(params: unknown, sender: CommandSender) {
        return BundleHandlers.applyBundleImport(params, sender);
    }

    @Component.Expose('Bundle.Export')
    @Component.CrudPermission('notifications', 'read')
    async exportNativeBundle(params: unknown, sender: CommandSender) {
        return BundleHandlers.exportNativeBundle(params, sender);
    }

    @Component.Expose('Bundle.ImportGrafana')
    @Component.CrudPermission('notifications', 'read')
    async importGrafanaBundle(params: unknown, sender: CommandSender) {
        return BundleHandlers.importGrafanaBundle(params, sender);
    }

    @Component.Expose('Bundle.ImportAlertmanager')
    @Component.CrudPermission('notifications', 'read')
    async importAlertmanagerBundle(params: unknown, sender: CommandSender) {
        return BundleHandlers.importAlertmanagerBundle(params, sender);
    }

    @Component.Expose('Bundle.ExportGrafana')
    @Component.CrudPermission('notifications', 'read')
    async exportGrafanaBundle(params: unknown, sender: CommandSender) {
        return BundleHandlers.exportGrafanaBundle(params, sender);
    }

    @Component.Expose('Bundle.ExportAlertmanager')
    @Component.CrudPermission('notifications', 'read')
    async exportAlertmanagerBundle(params: unknown, sender: CommandSender) {
        return BundleHandlers.exportAlertmanagerBundle(params, sender);
    }

    @Component.Expose('Preference.List')
    @Component.CrudPermission('notifications', 'read')
    async listPreferences(params: unknown, sender: CommandSender) {
        return RoutingHandlers.listPreferences(params, sender);
    }

    @Component.Expose('Preference.Set')
    @Component.CrudPermission('notifications', 'update')
    async setPreference(params: unknown, sender: CommandSender) {
        return RoutingHandlers.setPreference(params, sender);
    }

    @Component.Expose('OnCall.List')
    @Component.CrudPermission('notifications', 'read')
    async listOnCall(params: unknown, sender: CommandSender) {
        return RoutingHandlers.listOnCall(params, sender);
    }

    @Component.Expose('OnCall.Set')
    @Component.CrudPermission('notifications', 'update')
    async setOnCall(params: unknown, sender: CommandSender) {
        return RoutingHandlers.setOnCall(params, sender);
    }

    @Component.Expose('OnCall.Delete')
    @Component.CrudPermission('notifications', 'delete')
    async deleteOnCall(params: unknown, sender: CommandSender) {
        return RoutingHandlers.deleteOnCall(params, sender);
    }

    @Component.Expose('OnCall.Resolve')
    @Component.CrudPermission('notifications', 'read')
    async resolveOnCall(params: unknown, sender: CommandSender) {
        return RoutingHandlers.resolveOnCall(params, sender);
    }

    @Component.Expose('Routing.List')
    @Component.CrudPermission('notifications', 'read')
    async listRouting(params: unknown, sender: CommandSender) {
        return RoutingHandlers.listRouting(params, sender);
    }

    @Component.Expose('Routing.Set')
    @Component.CrudPermission('notifications', 'update')
    async setRouting(params: unknown, sender: CommandSender) {
        return RoutingHandlers.setRouting(params, sender);
    }

    @Component.Expose('Routing.Delete')
    @Component.CrudPermission('notifications', 'delete')
    async deleteRouting(params: unknown, sender: CommandSender) {
        return RoutingHandlers.deleteRouting(params, sender);
    }

    @Component.Expose('Routing.Evaluate')
    @Component.CrudPermission('notifications', 'read')
    async evaluateRouting(params: unknown, sender: CommandSender) {
        return RoutingHandlers.evaluateRouting(params, sender);
    }

    @Component.Expose('History.Requeue')
    @Component.CrudPermission(
        'notifications',
        'update',
        NOT_A_DESTINATION_GROUP_ID
    )
    async historyRequeue(
        params: unknown,
        sender: CommandSender
    ): Promise<DeliveryJob> {
        await requireTenantWideNotificationGrant(sender, 'update');
        return HistoryHandlers.historyRequeue(params, sender);
    }

    // ── Email template library ───────────────────────────────────────

    @Component.Expose('EmailTemplate.List')
    @Component.CrudPermission('notifications', 'read')
    async emailTemplateList(params: unknown, sender: CommandSender) {
        return EmailTemplateHandlers.emailTemplateList(params, sender);
    }

    @Component.Expose('EmailTemplate.Get')
    @Component.CrudPermission(
        'notifications',
        'read',
        NOT_A_DESTINATION_GROUP_ID
    )
    async emailTemplateGet(params: unknown, sender: CommandSender) {
        await requireTenantWideNotificationGrant(sender, 'read');
        return EmailTemplateHandlers.emailTemplateGet(params, sender);
    }

    @Component.Expose('EmailTemplate.Create')
    @Component.CrudPermission('notifications', 'create')
    async emailTemplateCreate(params: unknown, sender: CommandSender) {
        return EmailTemplateHandlers.emailTemplateCreate(params, sender);
    }

    @Component.Expose('EmailTemplate.Update')
    @Component.CrudPermission(
        'notifications',
        'update',
        NOT_A_DESTINATION_GROUP_ID
    )
    async emailTemplateUpdate(params: unknown, sender: CommandSender) {
        await requireTenantWideNotificationGrant(sender, 'update');
        return EmailTemplateHandlers.emailTemplateUpdate(params, sender);
    }

    @Component.Expose('EmailTemplate.Delete')
    @Component.CrudPermission(
        'notifications',
        'delete',
        NOT_A_DESTINATION_GROUP_ID
    )
    async emailTemplateDelete(params: unknown, sender: CommandSender) {
        await requireTenantWideNotificationGrant(sender, 'delete');
        return EmailTemplateHandlers.emailTemplateDelete(params, sender);
    }

    // ── Multi-channel message templates ──────────────────────────────

    @Component.NoAudit
    @Component.Expose('Template.List')
    @Component.CrudPermission('notifications', 'read')
    async messageTemplateList(params: unknown, sender: CommandSender) {
        return MessageTemplateHandlers.messageTemplateList(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('Template.Get')
    @Component.CrudPermission(
        'notifications',
        'read',
        NOT_A_DESTINATION_GROUP_ID
    )
    async messageTemplateGet(params: unknown, sender: CommandSender) {
        await requireTenantWideNotificationGrant(sender, 'read');
        return MessageTemplateHandlers.messageTemplateGet(params, sender);
    }

    @Component.Expose('Template.Create')
    @Component.CrudPermission('notifications', 'create')
    async messageTemplateCreate(params: unknown, sender: CommandSender) {
        return MessageTemplateHandlers.messageTemplateCreate(params, sender);
    }

    @Component.Expose('Template.Update')
    @Component.CrudPermission(
        'notifications',
        'update',
        NOT_A_DESTINATION_GROUP_ID
    )
    async messageTemplateUpdate(params: unknown, sender: CommandSender) {
        await requireTenantWideNotificationGrant(sender, 'update');
        return MessageTemplateHandlers.messageTemplateUpdate(params, sender);
    }

    @Component.Expose('Template.Delete')
    @Component.CrudPermission(
        'notifications',
        'delete',
        NOT_A_DESTINATION_GROUP_ID
    )
    async messageTemplateDelete(params: unknown, sender: CommandSender) {
        await requireTenantWideNotificationGrant(sender, 'delete');
        return MessageTemplateHandlers.messageTemplateDelete(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('EmailAsset.List')
    @Component.CrudPermission('notifications', 'read')
    async emailAssetList(params: unknown, sender: CommandSender) {
        return AssetHandlers.emailAssetList(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('EmailAsset.CreateUploadTicket')
    @Component.CheckPermissions(async (sender) => {
        const [canCreate, canUpdate] = await Promise.all([
            canPerformComponentOperationAsync(
                sender,
                'notifications',
                'create'
            ),
            canPerformComponentOperationAsync(sender, 'notifications', 'update')
        ]);
        return [canCreate, canUpdate].some(isComponentPermissionAllowed);
    })
    async emailAssetCreateUploadTicket(params: unknown, sender: CommandSender) {
        return AssetHandlers.emailAssetCreateUploadTicket(params, sender);
    }

    @Component.NoAudit
    @Component.Expose('EmailAsset.Get')
    @Component.CrudPermission(
        'notifications',
        'read',
        NOT_A_DESTINATION_GROUP_ID
    )
    async emailAssetGet(params: unknown, sender: CommandSender) {
        await requireTenantWideNotificationGrant(sender, 'read');
        return AssetHandlers.emailAssetGet(params, sender);
    }

    @Component.Expose('EmailAsset.Delete')
    @Component.CrudPermission(
        'notifications',
        'delete',
        NOT_A_DESTINATION_GROUP_ID
    )
    async emailAssetDelete(params: unknown, sender: CommandSender) {
        await requireTenantWideNotificationGrant(sender, 'delete');
        return AssetHandlers.emailAssetDelete(params, sender);
    }

    // Consent writes the channel's OAuth secret, so the channel is the resource.
    @Component.Expose('OAuth.Start')
    @Component.CrudPermission('integrations', 'update', (p) => p?.channelId)
    async oauthStart(params: unknown, sender: CommandSender) {
        return AssetHandlers.oauthStart(params, sender);
    }
}
