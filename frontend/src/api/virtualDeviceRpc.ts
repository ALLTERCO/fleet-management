import {sendRPC} from '@/tools/websocket';

const FM = 'FLEET_MANAGER';

export type DeviceKind =
    | 'physical'
    | 'bluetooth'
    | 'extracted'
    | 'composed'
    | 'connector';

export type VirtualDeviceKind = 'extracted' | 'composed' | 'connector';

export type ValueType = 'boolean' | 'number' | 'string' | 'event' | 'json';

export type HistoryMode = 'linked' | 'materialized' | 'derived' | 'live_only';

export type DynamicCategory = 'Virtual' | 'BTHome' | 'LNM';

export type CardProfile =
    | 'meter'
    | 'climate'
    | 'safety'
    | 'actuator'
    | 'custom';

export type RoleSlot =
    | 'primary'
    | 'secondary'
    | 'control'
    | 'diagnostic'
    | 'hidden';

export interface VirtualDeviceVisual {
    icon?: string;
    accent?: string;
    imageModel?: string;
    cardProfile?: CardProfile;
    summaryRoles?: string[];
    detailSections?: string[];
}

export interface RoleVisual {
    displayName?: string;
    icon?: string;
    slot?: RoleSlot;
    chart?: 'line' | 'area' | 'bar' | 'step' | 'state' | 'none';
    format?: Record<string, unknown>;
    alertDefaults?: Record<string, unknown>;
}

export interface ProfileRole {
    roleKey: string;
    label: string;
    valueType: ValueType;
    unit?: string;
    writable?: boolean;
    required?: boolean;
    historyMode: HistoryMode;
    visual?: RoleVisual;
    metadata?: Record<string, unknown>;
}

export interface ProfileDefaultVisual {
    icon?: string;
    accent?: string;
    imageModel?: string;
}

export interface VirtualDeviceProfileMetadata {
    categoryKey?: string;
    defaultVisual?: ProfileDefaultVisual;
}

export interface VirtualDeviceProfile {
    id: string;
    // null = system profile, shared across orgs and read-only via the API.
    organizationId: string | null;
    key: string;
    name: string;
    version: number;
    roles: ProfileRole[];
    metadata: VirtualDeviceProfileMetadata;
}

export interface SourceComponentRef {
    deviceExternalId: string;
    componentKey: string;
    dynamicCategory?: DynamicCategory;
}

export interface SourceComponentCandidate {
    deviceExternalId: string;
    deviceName: string;
    componentKey: string;
    componentType: string;
    dynamicCategory: DynamicCategory | null;
    label?: string | null;
    valueType?: ValueType;
    writable: boolean;
    connector?: {protocol: string; pointId: string | null};
}

export interface BindingDraftItem {
    roleKey: string;
    source: SourceComponentRef;
    visual?: RoleVisual;
}

export interface BindingDto {
    id: string;
    roleKey: string;
    source: SourceComponentRef;
    mode: HistoryMode;
    active: boolean;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    visual?: RoleVisual;
    createdAt: string;
}

export interface VirtualDeviceDto {
    deviceListId: number;
    externalId: string;
    organizationId: string;
    kind: VirtualDeviceKind;
    name: string;
    typeKey: string;
    categoryKey: string | null;
    profileId: string | null;
    imageAssetId: string | null;
    locationId: number | null;
    groupIds: number[];
    tagIds: number[];
    enabled: boolean;
    revision: number;
    visual?: VirtualDeviceVisual;
    metadata?: Record<string, unknown>;
}

export interface UploadTicketResponse {
    uploadTicket: string;
    expiresAt: string;
}

export type BluetoothCapability =
    | 'sensor'
    | 'event_only'
    | 'controllable'
    | 'trv';

export interface BluetoothSourceComponent {
    componentKey: string;
    kind: 'device' | 'sensor' | 'control' | 'trv';
    role: 'identity' | 'telemetry' | 'event_control' | 'writable_control';
    objectId: number | null;
    index: number | null;
    name: string | null;
    canWrite: boolean;
}

export interface BluetoothDeviceDto {
    deviceListId: number;
    externalId: string;
    stableId: string;
    bleAddress: string | null;
    productName: string | null;
    modelId: string | null;
    imageAssetId: string | null;
    capability: BluetoothCapability;
    keyRefSet: boolean;
    components: BluetoothSourceComponent[];
    visual: VirtualDeviceVisual;
    primaryTransport: {
        id: string;
        mode:
            | 'bthome_gateway'
            | 'blu_assistant_ws'
            | 'blu_assistant_serial'
            | 'host_bluetooth';
        canWrite: boolean;
        enabled: boolean;
        shellyDeviceExternalId: string | null;
        assistantDeviceExternalId: string | null;
        hostAdapterId: string | null;
        serialPortRef: string | null;
        lastSeenAt: string | null;
        lastRssi: number | null;
    } | null;
}

export interface BluetoothCandidate {
    gatewayDeviceListId: number;
    gatewayExternalId: string;
    componentKey: string;
    stableId: string;
    bleAddress: string;
    name: string | null;
    productName: string | null;
    modelId: string | null;
    capability: BluetoothCapability;
    components: BluetoothSourceComponent[];
    alreadyPromoted: boolean;
    bluetoothExternalId: string | null;
}

export interface ValidationError {
    code?: string;
    message?: string;
    roleKey?: string;
    [k: string]: unknown;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

export interface DraftPreviewResponse {
    device: VirtualDeviceDto;
    bindings: BindingDto[];
    validation: ValidationResult;
}

export interface ListResponse<T> {
    items: T[];
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
}

export interface CreateVirtualDeviceRequest {
    kind: VirtualDeviceKind;
    name: string;
    typeKey: string;
    categoryKey?: string;
    profileId?: string;
    imageAssetId?: string;
    locationId?: number;
    groupIds?: number[];
    tagIds?: number[];
    visual?: VirtualDeviceVisual;
    metadata?: Record<string, unknown>;
    bindings?: BindingDraftItem[];
}

export function listVirtualDeviceProfiles(input?: {
    query?: string;
    limit?: number;
    offset?: number;
}): Promise<ListResponse<VirtualDeviceProfile>> {
    return sendRPC(FM, 'virtualdevice.Profile.List', input ?? {});
}

export function updateVirtualDeviceProfile(input: {
    profileId: string;
    // Optional: super-admin can target another org. Omit for self-org.
    organizationId?: string;
    name?: string;
    metadata?: VirtualDeviceProfileMetadata;
}): Promise<VirtualDeviceProfile> {
    return sendRPC(FM, 'virtualdevice.Profile.Update', input);
}

export function listBindableSources(input?: {
    query?: string;
    componentType?: string;
    roleKey?: string;
    limit?: number;
    offset?: number;
}): Promise<ListResponse<SourceComponentCandidate>> {
    return sendRPC(FM, 'virtualdevice.Binding.ListSources', input ?? {});
}

export interface ProfileSuggestRoleFit {
    roleKey: string;
    required: boolean;
    matched: boolean;
    bestComponentKey: string | null;
    bestScore: number;
}

export interface ProfileSuggestCandidate {
    profile: {id: string; key: string; name: string; version: number};
    confidence: number;
    coverage: number;
    matchedRequired: number;
    totalRequired: number;
    reasons: string[];
    roleFitness: ProfileSuggestRoleFit[];
}

export interface ProfileSuggestResponse {
    device: {
        externalId: string;
        kind: 'physical' | 'bluetooth';
        modelHint: string | null;
    };
    candidates: ProfileSuggestCandidate[];
}

export function suggestProfileForDevice(input: {
    deviceExternalId: string;
    limit?: number;
}): Promise<ProfileSuggestResponse> {
    return sendRPC(FM, 'virtualdevice.Profile.SuggestFromDevice', input);
}

export function validateVirtualBindings(input: {
    externalId: string;
    bindings: BindingDraftItem[];
}): Promise<ValidationResult> {
    return sendRPC(FM, 'virtualdevice.Binding.ValidateDraft', input);
}

export function previewVirtualDevice(input: {
    device: CreateVirtualDeviceRequest;
    bindings: BindingDraftItem[];
}): Promise<DraftPreviewResponse> {
    return sendRPC(FM, 'virtualdevice.Draft.Preview', input);
}

export function createVirtualDevice(
    input: CreateVirtualDeviceRequest
): Promise<VirtualDeviceDto> {
    return sendRPC(FM, 'virtualdevice.Create', input);
}

export function createVirtualDeviceImageUploadTicket(input: {
    externalId: string;
}): Promise<UploadTicketResponse> {
    return sendRPC(FM, 'virtualdevice.Image.CreateUploadTicket', input);
}

export function createBluetoothImageUploadTicket(input: {
    externalId: string;
}): Promise<UploadTicketResponse> {
    return sendRPC(
        FM,
        'virtualdevice.Bluetooth.Image.CreateUploadTicket',
        input
    );
}

export function listBluetoothCandidates(input?: {
    gatewayExternalId?: string;
    query?: string;
    limit?: number;
    offset?: number;
}): Promise<ListResponse<BluetoothCandidate>> {
    return sendRPC(FM, 'virtualdevice.Bluetooth.Candidate.List', input ?? {});
}

export function promoteBluetoothFromGateway(input: {
    gatewayExternalId: string;
    componentKey: string;
    makePrimary?: boolean;
}): Promise<BluetoothDeviceDto> {
    return sendRPC(FM, 'virtualdevice.Bluetooth.PromoteFromGateway', input);
}

export function deleteBluetoothDevice(input: {
    externalId: string;
    retention?: 'tombstone' | 'purge';
    unpairFromGateway?: boolean;
    ignoreGatewayErrors?: boolean;
}): Promise<{externalId: string; deleted: boolean}> {
    return sendRPC(FM, 'virtualdevice.Bluetooth.Delete', input);
}

export function createVirtualDeviceBinding(input: {
    externalId: string;
    roleKey: string;
    source: SourceComponentRef;
    expectedRevision: number;
    effectiveFrom?: string;
    visual?: RoleVisual;
    reason?: string;
}): Promise<BindingDto> {
    return sendRPC(FM, 'virtualdevice.Binding.Create', input);
}

export function listVirtualDeviceBindings(input: {
    externalId: string;
}): Promise<{items: BindingDto[]}> {
    return sendRPC(FM, 'virtualdevice.Binding.List', input);
}

export interface ExtractionPreviewResponse {
    hostDeviceListId: number;
    hostExternalId: string;
    sourceKey: string;
    sourceType: 'virtual_group' | 'service';
    name: string;
    typeKey: string;
    categoryKey: string | null;
    roles: Array<{
        roleKey: string;
        label: string;
        valueType: ValueType;
        unit?: string;
        writable?: boolean;
        sourceComponentKey: string;
    }>;
    bindings: SourceComponentRef[];
    hiddenSourceComponentKeys: string[];
    alreadyExtracted: boolean;
    extractedExternalId: string | null;
}

export function previewExtraction(input: {
    hostExternalId: string;
    sourceKey: string;
}): Promise<ExtractionPreviewResponse> {
    return sendRPC(FM, 'virtualdevice.Extraction.Preview', input);
}

export function createExtraction(input: {
    hostExternalId: string;
    sourceKey: string;
    name?: string;
    typeKey?: string;
    categoryKey?: string;
    imageAssetId?: string;
    locationId?: number;
    groupIds?: number[];
    tagIds?: number[];
}): Promise<VirtualDeviceDto> {
    return sendRPC(FM, 'virtualdevice.Extraction.Create', input);
}
