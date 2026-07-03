import {
    canCrossOrganizationBoundary,
    requireComponentPermissionAsync
} from '../../modules/authz/evaluator';
import * as EventDistributor from '../../modules/EventDistributor';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {
    issueUploadTicket,
    uploadTicketResponse,
    uploadTicketUserFromSender
} from '../../modules/uploadTickets';
import {runVirtualDeviceMutation} from '../../modules/virtualDevice/accessInvalidation';
import {applyProfileVisualDefaults} from '../../modules/virtualDevice/applyProfileVisualDefaults';
import {
    createVirtualDeviceBinding,
    listVirtualDeviceBindingSources,
    listVirtualDeviceBindings,
    previewVirtualDeviceDraft,
    replaceVirtualDeviceBinding,
    retireVirtualDeviceBinding,
    validateVirtualDeviceBindingDraft
} from '../../modules/virtualDevice/bindingRepository';
import {unpairBluetoothFromGateways} from '../../modules/virtualDevice/bluetoothGatewayUnpair';
import {
    clearBluetoothKeyRef as clearBluetoothKeyRefRepository,
    deleteBluetoothDevice,
    getBluetoothDevice,
    listBluetoothCandidates,
    listBluetoothDevices,
    listBluetoothTransports,
    promoteBluetoothFromGateway,
    setBluetoothKeyRef as setBluetoothKeyRefRepository,
    setPrimaryBluetoothTransport as setPrimaryBluetoothTransportRepository,
    updateBluetoothDecoration
} from '../../modules/virtualDevice/bluetoothRepository';
import {invokeVirtualDeviceRoleCommand} from '../../modules/virtualDevice/commandRouter';
import {
    createExtractedDevice,
    previewExtractedDevice,
    previewExtractionReplacement
} from '../../modules/virtualDevice/extractionRepository';
import {backfillVirtualDeviceHistory} from '../../modules/virtualDevice/historyBackfill';
import {
    readVirtualDeviceRoleHistory,
    readVirtualDeviceRoleProvenance
} from '../../modules/virtualDevice/historyRepository';
import {
    applyVirtualDeviceManifest,
    exportVirtualDeviceManifest,
    planVirtualDeviceManifest,
    validateVirtualDeviceManifest
} from '../../modules/virtualDevice/manifestRepository';
import {matchVirtualDeviceProfileSources} from '../../modules/virtualDevice/profileMatchSources';
import {
    createPerOrgProfile,
    listVirtualDeviceProfiles,
    updatePerOrgProfile,
    validateProfileRoles
} from '../../modules/virtualDevice/profileRepository';
import {suggestVirtualDeviceProfileForDevice} from '../../modules/virtualDevice/profileSuggestForDevice';
import {readVirtualDeviceReplacementReport} from '../../modules/virtualDevice/replacementReport';
import {
    createVirtualDevice,
    deleteVirtualDevice,
    getVirtualDevice,
    listVirtualDevices,
    updateVirtualDevice
} from '../../modules/virtualDevice/repository';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {requireOrganizationId} from '../../rpc/scope';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    BLUETOOTH_CANDIDATE_LIST_PARAMS_SCHEMA,
    BLUETOOTH_DELETE_PARAMS_SCHEMA,
    BLUETOOTH_DEVICE_GET_PARAMS_SCHEMA,
    BLUETOOTH_DEVICE_LIST_PARAMS_SCHEMA,
    BLUETOOTH_KEY_CLEAR_PARAMS_SCHEMA,
    BLUETOOTH_KEY_SET_REF_PARAMS_SCHEMA,
    BLUETOOTH_PROMOTE_FROM_GATEWAY_PARAMS_SCHEMA,
    BLUETOOTH_TRANSPORT_LIST_PARAMS_SCHEMA,
    BLUETOOTH_TRANSPORT_SET_PRIMARY_PARAMS_SCHEMA,
    BLUETOOTH_UPDATE_PARAMS_SCHEMA,
    type BluetoothDeleteParams,
    type BluetoothDeviceCandidateListParams,
    type BluetoothDeviceGetParams,
    type BluetoothDeviceListParams,
    type BluetoothKeyClearParams,
    type BluetoothKeySetRefParams,
    type BluetoothPromoteFromGatewayParams,
    type BluetoothTransportListParams,
    type BluetoothTransportSetPrimaryParams,
    type BluetoothUpdateParams,
    VIRTUAL_DEVICE_BINDING_CREATE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_BINDING_LIST_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_BINDING_LIST_SOURCES_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_BINDING_REPLACE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_BINDING_RETIRE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_BINDING_VALIDATE_DRAFT_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_COMMAND_INVOKE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_CREATE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_DELETE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_DESCRIBE,
    VIRTUAL_DEVICE_DRAFT_PREVIEW_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_EXTRACTION_CREATE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_EXTRACTION_PREVIEW_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_EXTRACTION_REPLACEMENT_PREVIEW_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_GET_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_HISTORY_BACKFILL_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_HISTORY_READ_PROVENANCE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_HISTORY_READ_ROLE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_LIST_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_MANIFEST_APPLY_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_MANIFEST_EXPORT_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_MANIFEST_PLAN_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_MANIFEST_VALIDATE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_PROFILE_CREATE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_PROFILE_LIST_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_PROFILE_MATCH_SOURCES_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_PROFILE_SUGGEST_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_PROFILE_UPDATE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_PROFILE_VALIDATE_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_REPLACEMENT_REPORT_PARAMS_SCHEMA,
    VIRTUAL_DEVICE_UPDATE_PARAMS_SCHEMA,
    type VirtualDeviceBindingCreateParams,
    type VirtualDeviceBindingListParams,
    type VirtualDeviceBindingListSourcesParams,
    type VirtualDeviceBindingReplaceParams,
    type VirtualDeviceBindingRetireParams,
    type VirtualDeviceBindingValidateDraftParams,
    type VirtualDeviceCommandInvokeParams,
    type VirtualDeviceCreateParams,
    type VirtualDeviceDeleteParams,
    type VirtualDeviceDraftPreviewParams,
    type VirtualDeviceExtractionCreateParams,
    type VirtualDeviceExtractionPreviewParams,
    type VirtualDeviceExtractionReplacementPreviewParams,
    type VirtualDeviceGetParams,
    type VirtualDeviceHistoryBackfillParams,
    type VirtualDeviceHistoryReadProvenanceParams,
    type VirtualDeviceHistoryReadRoleParams,
    type VirtualDeviceListParams,
    type VirtualDeviceManifestExportParams,
    type VirtualDeviceManifestParams,
    type VirtualDeviceManifestPlanDto,
    type VirtualDeviceProfileCreateParams,
    type VirtualDeviceProfileListParams,
    type VirtualDeviceProfileMatchSourcesParams,
    type VirtualDeviceProfileSuggestParams,
    type VirtualDeviceProfileUpdateParams,
    type VirtualDeviceProfileValidateParams,
    type VirtualDeviceReplacementReportParams,
    type VirtualDeviceUpdateParams
} from '../../types/api/virtualdevice';
import type CommandSender from '../CommandSender';
import Component from './Component';

const VIRTUAL_DEVICE_INVENTORY_SOURCE = 'virtual';
const BLUETOOTH_DEVICE_INVENTORY_SOURCE = 'bluetooth';

export default class VirtualDeviceComponent extends Component {
    constructor() {
        super('virtualdevice', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    protected override getComponentName() {
        return 'devices' as const;
    }

    protected override extractItemId(
        params?: Record<string, unknown>
    ): string | number | undefined {
        return typeof params?.externalId === 'string'
            ? params.externalId
            : super.extractItemId(params);
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return VIRTUAL_DEVICE_DESCRIBE;
    }

    @Component.Expose('Create')
    @Component.CrudPermission('devices', 'create')
    async create(params: unknown, sender: CommandSender): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceCreateParams>(
            params,
            VIRTUAL_DEVICE_CREATE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const withDefaults = await applyProfileVisualDefaults(
            organizationId,
            p
        );
        const device = await runVirtualDeviceMutation(organizationId, () =>
            createVirtualDevice({
                ...withDefaults,
                organizationId,
                actorId:
                    sender.getUser()?.username ?? sender.getUserId() ?? null
            })
        );
        EventDistributor.emitDeviceCreated({
            externalId: device.externalId,
            source: VIRTUAL_DEVICE_INVENTORY_SOURCE,
            orgId: organizationId
        });
        return device;
    }

    @Component.Expose('Get')
    @Component.CrudPermission('devices', 'read', (p) => p?.externalId)
    async get(params: unknown, sender: CommandSender): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceGetParams>(
            params,
            VIRTUAL_DEVICE_GET_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const row = await getVirtualDevice(organizationId, p.externalId);
        if (!row) throw RpcError.NotFound('virtual_device', p.externalId);
        return row;
    }

    @Component.Expose('List')
    @Component.CrudPermission('devices', 'read')
    async list(params: unknown, sender: CommandSender): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceListParams>(
            params,
            VIRTUAL_DEVICE_LIST_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        return listVirtualDevices(organizationId, p);
    }

    @Component.Expose('Update')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async update(params: unknown, sender: CommandSender): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceUpdateParams>(
            params,
            VIRTUAL_DEVICE_UPDATE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const device = await runVirtualDeviceMutation(organizationId, () =>
            updateVirtualDevice(organizationId, p)
        );
        EventDistributor.emitDeviceUpdated({
            externalId: device.externalId,
            source: VIRTUAL_DEVICE_INVENTORY_SOURCE,
            orgId: organizationId
        });
        return device;
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('devices', 'delete', (p) => p?.externalId)
    async delete(params: unknown, sender: CommandSender): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceDeleteParams>(
            params,
            VIRTUAL_DEVICE_DELETE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const result = await runVirtualDeviceMutation(organizationId, () =>
            deleteVirtualDevice(organizationId, p)
        );
        EventDistributor.emitDeviceDeleted({
            externalId: p.externalId,
            source: VIRTUAL_DEVICE_INVENTORY_SOURCE,
            orgId: organizationId
        });
        return result;
    }

    @Component.Expose('Extraction.Preview')
    @Component.CrudPermission('devices', 'read', (p) => p?.hostExternalId)
    async previewExtraction(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceExtractionPreviewParams>(
            params,
            VIRTUAL_DEVICE_EXTRACTION_PREVIEW_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        return previewExtractedDevice(organizationId, p);
    }

    @Component.Expose('Extraction.Create')
    @Component.CrudPermission('devices', 'create')
    async createExtraction(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceExtractionCreateParams>(
            params,
            VIRTUAL_DEVICE_EXTRACTION_CREATE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const withDefaults = await applyProfileVisualDefaults(
            organizationId,
            p
        );
        const device = await runVirtualDeviceMutation(organizationId, () =>
            createExtractedDevice(
                organizationId,
                withDefaults,
                sender.getUser()?.username ?? sender.getUserId() ?? null
            )
        );
        EventDistributor.emitDeviceCreated({
            externalId: device.externalId,
            source: VIRTUAL_DEVICE_INVENTORY_SOURCE,
            orgId: organizationId
        });
        return device;
    }

    @Component.Expose('Extraction.ReplacementPreview')
    @Component.CrudPermission('devices', 'read')
    async previewExtractionReplacement(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p =
            validateOrThrow<VirtualDeviceExtractionReplacementPreviewParams>(
                params,
                VIRTUAL_DEVICE_EXTRACTION_REPLACEMENT_PREVIEW_PARAMS_SCHEMA
            );
        const organizationId = requireOrganizationId(sender);
        return previewExtractionReplacement(organizationId, p);
    }

    @Component.Expose('Profile.List')
    @Component.CrudPermission('devices', 'read')
    async listProfiles(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceProfileListParams>(
            params ?? {},
            VIRTUAL_DEVICE_PROFILE_LIST_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        return listVirtualDeviceProfiles(organizationId, p);
    }

    @Component.Expose('Profile.Create')
    @Component.CrudPermission('devices', 'create')
    async createProfile(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceProfileCreateParams>(
            params,
            VIRTUAL_DEVICE_PROFILE_CREATE_PARAMS_SCHEMA
        );
        // RPC callers always target their own org; null is seeder-only.
        const organizationId = requireOrganizationId(sender, {
            organizationId: p.organizationId ?? undefined
        });
        return createPerOrgProfile({...p, organizationId});
    }

    @Component.Expose('Profile.Update')
    @Component.CrudPermission('devices', 'update')
    async updateProfile(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceProfileUpdateParams>(
            params,
            VIRTUAL_DEVICE_PROFILE_UPDATE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, {
            organizationId: p.organizationId ?? undefined
        });
        return updatePerOrgProfile(organizationId, p);
    }

    @Component.Expose('Profile.Validate')
    @Component.CrudPermission('devices', 'read')
    validateProfile(params: unknown): unknown {
        const p = validateOrThrow<VirtualDeviceProfileValidateParams>(
            params,
            VIRTUAL_DEVICE_PROFILE_VALIDATE_PARAMS_SCHEMA
        );
        return validateProfileRoles(p.roles);
    }

    @Component.Expose('Profile.MatchSources')
    @Component.CrudPermission('devices', 'read')
    async matchProfileSources(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceProfileMatchSourcesParams>(
            params ?? {},
            VIRTUAL_DEVICE_PROFILE_MATCH_SOURCES_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        return matchVirtualDeviceProfileSources(organizationId, p, {
            queryRows: PostgresProvider.queryRows,
            filterAccessible: canCrossOrganizationBoundary(sender)
                ? undefined
                : (externalIds) =>
                      sender.filterAccessibleDevices([...externalIds])
        });
    }

    @Component.Expose('Profile.SuggestFromDevice')
    @Component.CrudPermission('devices', 'read', (p) => p?.deviceExternalId)
    async suggestProfileForDevice(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceProfileSuggestParams>(
            params,
            VIRTUAL_DEVICE_PROFILE_SUGGEST_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        return suggestVirtualDeviceProfileForDevice(organizationId, p);
    }

    @Component.Expose('Binding.List')
    @Component.CrudPermission('devices', 'read', (p) => p?.externalId)
    async listBindings(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceBindingListParams>(
            params,
            VIRTUAL_DEVICE_BINDING_LIST_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return listVirtualDeviceBindings(organizationId, p);
    }

    @Component.Expose('Binding.ListSources')
    @Component.CrudPermission('devices', 'read')
    async listBindingSources(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceBindingListSourcesParams>(
            params ?? {},
            VIRTUAL_DEVICE_BINDING_LIST_SOURCES_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const page = await listVirtualDeviceBindingSources(organizationId, {
            ...p,
            limit: 0,
            offset: 0
        });
        const accessible = await sender.filterAccessibleDevices(
            page.items.map((item) => item.deviceExternalId)
        );
        const allItems = page.items.filter((item) =>
            accessible.has(item.deviceExternalId)
        );
        const limit = p.limit ?? 200;
        const offset = p.offset ?? 0;
        const items =
            limit === 0
                ? allItems.slice(offset)
                : allItems.slice(offset, offset + limit);
        return {
            items,
            total: allItems.length,
            limit,
            offset,
            has_more: limit !== 0 && offset + items.length < allItems.length
        };
    }

    @Component.Expose('Binding.ValidateDraft')
    @Component.CrudPermission('devices', 'read', (p) => p?.externalId)
    async validateBindingDraft(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceBindingValidateDraftParams>(
            params,
            VIRTUAL_DEVICE_BINDING_VALIDATE_DRAFT_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return validateVirtualDeviceBindingDraft(organizationId, p);
    }

    @Component.Expose('Draft.Preview')
    @Component.CrudPermission('devices', 'read')
    async previewDraft(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceDraftPreviewParams>(
            params,
            VIRTUAL_DEVICE_DRAFT_PREVIEW_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p.device);
        return previewVirtualDeviceDraft(organizationId, p);
    }

    @Component.Expose('Binding.Create')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async createBinding(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceBindingCreateParams>(
            params,
            VIRTUAL_DEVICE_BINDING_CREATE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const binding = await runVirtualDeviceMutation(organizationId, () =>
            createVirtualDeviceBinding(
                organizationId,
                p,
                sender.getUser()?.username ?? sender.getUserId() ?? null
            )
        );
        EventDistributor.emitDeviceRelationshipChanged({
            externalId: p.externalId,
            orgId: organizationId,
            reason: 'VirtualDevice.Binding.Create'
        });
        return binding;
    }

    @Component.Expose('Binding.Replace')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async replaceBinding(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceBindingReplaceParams>(
            params,
            VIRTUAL_DEVICE_BINDING_REPLACE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const binding = await runVirtualDeviceMutation(organizationId, () =>
            replaceVirtualDeviceBinding(
                organizationId,
                p,
                sender.getUser()?.username ?? sender.getUserId() ?? null
            )
        );
        EventDistributor.emitDeviceRelationshipChanged({
            externalId: p.externalId,
            orgId: organizationId,
            reason: 'VirtualDevice.Binding.Replace'
        });
        return binding;
    }

    @Component.Expose('Binding.Retire')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async retireBinding(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceBindingRetireParams>(
            params,
            VIRTUAL_DEVICE_BINDING_RETIRE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const binding = await runVirtualDeviceMutation(organizationId, () =>
            retireVirtualDeviceBinding(
                organizationId,
                p,
                sender.getUser()?.username ?? sender.getUserId() ?? null
            )
        );
        EventDistributor.emitDeviceRelationshipChanged({
            externalId: p.externalId,
            orgId: organizationId,
            reason: 'VirtualDevice.Binding.Retire'
        });
        return binding;
    }

    @Component.NoAudit
    @Component.Expose('Command.Invoke')
    @Component.CrudPermission('devices', 'execute', (p) => p?.externalId)
    async invokeCommand(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceCommandInvokeParams>(
            params,
            VIRTUAL_DEVICE_COMMAND_INVOKE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return invokeVirtualDeviceRoleCommand(organizationId, p, {
            actorId: sender.getUser()?.username ?? sender.getUserId() ?? null,
            organizationId,
            ipAddress: sender.getSourceIp(),
            authorizeSource: (deviceExternalId) =>
                requireComponentPermissionAsync(
                    sender,
                    'devices',
                    'execute',
                    deviceExternalId
                ).then(() => undefined)
        });
    }

    @Component.Expose('History.ReadRole')
    @Component.CrudPermission('devices', 'read', (p) => p?.externalId)
    async readRoleHistory(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceHistoryReadRoleParams>(
            params,
            VIRTUAL_DEVICE_HISTORY_READ_ROLE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return readVirtualDeviceRoleHistory(organizationId, p);
    }

    @Component.Expose('History.ReadProvenance')
    @Component.CrudPermission('devices', 'read', (p) => p?.externalId)
    async readRoleProvenance(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceHistoryReadProvenanceParams>(
            params,
            VIRTUAL_DEVICE_HISTORY_READ_PROVENANCE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return readVirtualDeviceRoleProvenance(organizationId, p);
    }

    @Component.Expose('History.Backfill')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async backfillHistory(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceHistoryBackfillParams>(
            params,
            VIRTUAL_DEVICE_HISTORY_BACKFILL_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return backfillVirtualDeviceHistory(organizationId, p);
    }

    @Component.Expose('Binding.ReplacementReport')
    @Component.CrudPermission('devices', 'read', (p) => p?.externalId)
    async readReplacementReport(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceReplacementReportParams>(
            params,
            VIRTUAL_DEVICE_REPLACEMENT_REPORT_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return readVirtualDeviceReplacementReport(organizationId, p);
    }

    @Component.Expose('Manifest.Validate')
    @Component.CrudPermission('devices', 'read')
    validateManifest(params: unknown): unknown {
        const p = validateOrThrow<VirtualDeviceManifestParams>(
            params,
            VIRTUAL_DEVICE_MANIFEST_VALIDATE_PARAMS_SCHEMA
        );
        return validateVirtualDeviceManifest(p.manifest);
    }

    @Component.Expose('Manifest.Export')
    @Component.CrudPermission('devices', 'read')
    async exportManifest(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceManifestExportParams>(
            params ?? {},
            VIRTUAL_DEVICE_MANIFEST_EXPORT_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        return exportVirtualDeviceManifest(organizationId, p.externalIds);
    }

    @Component.Expose('Manifest.Plan')
    @Component.CrudPermission('devices', 'read')
    async planManifest(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceManifestParams>(
            params,
            VIRTUAL_DEVICE_MANIFEST_PLAN_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        await this.#authorizeManifestDevices(sender, p);
        return planVirtualDeviceManifest(organizationId, p.manifest);
    }

    @Component.Expose('Manifest.Apply')
    @Component.CheckPermissions(canAttemptManifestApply)
    async applyManifest(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceManifestParams>(
            params,
            VIRTUAL_DEVICE_MANIFEST_APPLY_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        await this.#authorizeManifestApply(sender, p, organizationId);
        return runVirtualDeviceMutation(organizationId, () =>
            applyVirtualDeviceManifest(
                organizationId,
                p.manifest,
                sender.getUser()?.username ?? sender.getUserId() ?? null
            )
        );
    }

    @Component.Expose('Bluetooth.Candidate.List')
    @Component.CrudPermission('devices', 'read')
    async listBluetoothCandidateDevices(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothDeviceCandidateListParams>(
            params ?? {},
            BLUETOOTH_CANDIDATE_LIST_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        return listBluetoothCandidates(organizationId, p);
    }

    @Component.Expose('Bluetooth.PromoteFromGateway')
    @Component.CrudPermission('devices', 'create')
    async promoteBluetoothDevice(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothPromoteFromGatewayParams>(
            params,
            BLUETOOTH_PROMOTE_FROM_GATEWAY_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        const device = await runVirtualDeviceMutation(organizationId, () =>
            promoteBluetoothFromGateway(
                organizationId,
                p,
                sender.getUser()?.username ?? sender.getUserId() ?? null
            )
        );
        EventDistributor.emitDeviceCreated({
            externalId: device.externalId,
            source: BLUETOOTH_DEVICE_INVENTORY_SOURCE,
            orgId: organizationId
        });
        return device;
    }

    @Component.Expose('Bluetooth.List')
    @Component.CrudPermission('devices', 'read')
    async listBluetooth(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothDeviceListParams>(
            params ?? {},
            BLUETOOTH_DEVICE_LIST_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender, p);
        return listBluetoothDevices(organizationId, p);
    }

    @Component.Expose('Bluetooth.Get')
    @Component.CrudPermission('devices', 'read', (p) => p?.externalId)
    async getBluetooth(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothDeviceGetParams>(
            params,
            BLUETOOTH_DEVICE_GET_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const row = await getBluetoothDevice(organizationId, p.externalId);
        if (!row) throw RpcError.NotFound('bluetooth_device', p.externalId);
        return row;
    }

    @Component.Expose('Bluetooth.Delete')
    @Component.CrudPermission('devices', 'delete', (p) => p?.externalId)
    async deleteBluetooth(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothDeleteParams>(
            params,
            BLUETOOTH_DELETE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        if (p.unpairFromGateway !== false) {
            await unpairBluetoothFromGateways(
                organizationId,
                p,
                p.ignoreGatewayErrors === true
            );
        }
        const result = await runVirtualDeviceMutation(organizationId, () =>
            deleteBluetoothDevice(organizationId, p)
        );
        EventDistributor.emitDeviceDeleted({
            externalId: p.externalId,
            source: BLUETOOTH_DEVICE_INVENTORY_SOURCE,
            orgId: organizationId
        });
        return result;
    }

    @Component.NoAudit
    @Component.Expose('Image.CreateUploadTicket')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async createVirtualImageUploadTicket(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<VirtualDeviceGetParams>(
            params,
            VIRTUAL_DEVICE_GET_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const device = await getVirtualDevice(organizationId, p.externalId);
        if (!device) throw RpcError.NotFound('virtual_device', p.externalId);
        return uploadTicketResponse(
            await issueUploadTicket({
                kind: 'visual_asset',
                user: uploadTicketUserFromSender(sender),
                payload: {
                    resourceKind: 'virtual-device',
                    resourceId: p.externalId
                }
            })
        );
    }

    @Component.Expose('Bluetooth.Transport.List')
    @Component.CrudPermission('devices', 'read', (p) => p?.externalId)
    async listBluetoothTransport(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothTransportListParams>(
            params,
            BLUETOOTH_TRANSPORT_LIST_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return listBluetoothTransports(organizationId, p.externalId);
    }

    @Component.Expose('Bluetooth.Transport.SetPrimary')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async setPrimaryBluetoothTransport(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothTransportSetPrimaryParams>(
            params,
            BLUETOOTH_TRANSPORT_SET_PRIMARY_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return setPrimaryBluetoothTransportRepository(organizationId, p);
    }

    @Component.Expose('Bluetooth.Key.SetRef')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async setBluetoothKeyRef(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothKeySetRefParams>(
            params,
            BLUETOOTH_KEY_SET_REF_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        return setBluetoothKeyRefRepository(
            organizationId,
            p,
            sender.getUser()?.username ?? sender.getUserId() ?? null
        );
    }

    @Component.Expose('Bluetooth.Key.Clear')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async clearBluetoothKeyRef(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothKeyClearParams>(
            params,
            BLUETOOTH_KEY_CLEAR_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const result = await clearBluetoothKeyRefRepository(
            organizationId,
            p,
            sender.getUser()?.username ?? sender.getUserId() ?? null
        );
        EventDistributor.emitDeviceRelationshipChanged({
            externalId: p.externalId,
            orgId: organizationId,
            reason: 'Bluetooth.Key.Clear'
        });
        return result;
    }

    @Component.Expose('Bluetooth.Update')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async updateBluetoothDecoration(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothUpdateParams>(
            params,
            BLUETOOTH_UPDATE_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const device = await updateBluetoothDecoration(organizationId, p);
        EventDistributor.emitDeviceUpdated({
            externalId: device.externalId,
            source: BLUETOOTH_DEVICE_INVENTORY_SOURCE,
            orgId: organizationId
        });
        return device;
    }

    @Component.NoAudit
    @Component.Expose('Bluetooth.Image.CreateUploadTicket')
    @Component.CrudPermission('devices', 'update', (p) => p?.externalId)
    async createBluetoothImageUploadTicket(
        params: unknown,
        sender: CommandSender
    ): Promise<unknown> {
        const p = validateOrThrow<BluetoothDeviceGetParams>(
            params,
            BLUETOOTH_DEVICE_GET_PARAMS_SCHEMA
        );
        const organizationId = requireOrganizationId(sender);
        const device = await getBluetoothDevice(organizationId, p.externalId);
        if (!device) throw RpcError.NotFound('bluetooth_device', p.externalId);
        return uploadTicketResponse(
            await issueUploadTicket({
                kind: 'visual_asset',
                user: uploadTicketUserFromSender(sender),
                payload: {
                    resourceKind: 'bluetooth-device',
                    resourceId: p.externalId
                }
            })
        );
    }

    async #authorizeManifestDevices(
        sender: CommandSender,
        params: VirtualDeviceManifestParams
    ): Promise<void> {
        for (const externalId of manifestDeviceIds(params)) {
            await requireComponentPermissionAsync(
                sender,
                'devices',
                'read',
                externalId
            );
        }
    }

    async #authorizeManifestApply(
        sender: CommandSender,
        params: VirtualDeviceManifestParams,
        organizationId: string
    ): Promise<void> {
        await this.#authorizeManifestSourceReads(sender, params);
        const plan = await planVirtualDeviceManifest(
            organizationId,
            params.manifest
        );
        if (!plan.valid) return;
        await this.#authorizeManifestPlanChanges(sender, plan);
    }

    async #authorizeManifestSourceReads(
        sender: CommandSender,
        params: VirtualDeviceManifestParams
    ): Promise<void> {
        for (const externalId of manifestSourceDeviceIds(params)) {
            await requireComponentPermissionAsync(
                sender,
                'devices',
                'read',
                externalId
            );
        }
    }

    async #authorizeManifestPlanChanges(
        sender: CommandSender,
        plan: VirtualDeviceManifestPlanDto
    ): Promise<void> {
        for (const change of plan.changes) {
            if (change.resourceType === 'profile') {
                if (change.action === 'create') {
                    await requireComponentPermissionAsync(
                        sender,
                        'devices',
                        'create'
                    );
                }
                continue;
            }
            if (change.resourceType === 'device') {
                await requireComponentPermissionAsync(
                    sender,
                    'devices',
                    change.action === 'create' ? 'create' : 'update',
                    change.ref
                );
                continue;
            }
            await requireComponentPermissionAsync(
                sender,
                'devices',
                'update',
                manifestBindingTargetId(change.ref)
            );
        }
    }
}

function manifestDeviceIds(params: VirtualDeviceManifestParams): string[] {
    const ids = new Set<string>();
    for (const device of params.manifest.spec.devices ?? []) {
        ids.add(device.externalId);
    }
    for (const binding of params.manifest.spec.bindings ?? []) {
        ids.add(binding.externalId);
        ids.add(binding.source.deviceExternalId);
    }
    return [...ids].sort();
}

function manifestSourceDeviceIds(
    params: VirtualDeviceManifestParams
): string[] {
    const remap = params.manifest.spec.remap?.sources ?? {};
    const ids = new Set<string>();
    for (const binding of params.manifest.spec.bindings ?? []) {
        ids.add(
            remap[binding.source.deviceExternalId] ??
                binding.source.deviceExternalId
        );
    }
    return [...ids].sort();
}

function manifestBindingTargetId(ref: string): string {
    return ref.split(':', 1)[0] ?? ref;
}

function canAttemptManifestApply(sender: CommandSender): boolean {
    return sender.canWrite();
}
