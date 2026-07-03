import {tuning} from '../../config/tuning';
import RpcError from '../../rpc/RpcError';
import {
    DEVICE_RELATIONSHIP_DEFAULT_INCLUDES,
    type DeviceRelationshipInclude,
    type DeviceRelationshipsGetParams,
    type DeviceRelationshipsQueryParams,
    type DeviceRelationshipsQueryResponse,
    type DeviceRelationshipsResponse
} from '../../types/api/device';
import * as DeviceCollector from '../DeviceCollector';

import {buildDeviceRelationshipGraph} from './relationshipBuilder';
import {loadRelationshipFacts} from './relationshipRepository';
import type {
    DeviceRelationshipPermissions,
    RelationshipGraphFacts,
    RelationshipGraphRequest,
    RelationshipReadableResources
} from './types';

export interface DeviceRelationshipsInput {
    organizationId: string | undefined;
    params: DeviceRelationshipsGetParams;
    permissions: DeviceRelationshipPermissions;
    filterAccessibleDevices?: (
        externalIds: readonly string[]
    ) => Promise<Set<string>>;
    readableResources?: RelationshipReadableResources;
}

export interface DeviceRelationshipsQueryInput {
    organizationId: string | undefined;
    params: DeviceRelationshipsQueryParams;
    permissions: DeviceRelationshipPermissions;
    filterAccessibleDevices?: (
        externalIds: readonly string[]
    ) => Promise<Set<string>>;
    readableResources?: RelationshipReadableResources;
}

export async function getDeviceRelationships(
    input: DeviceRelationshipsInput
): Promise<DeviceRelationshipsResponse> {
    const request = buildGraphRequest(input.params);
    const facts = await loadGraphFacts({input, request});
    if (!facts) throw RpcError.DeviceNotFound();
    return buildDeviceRelationshipGraph({request, facts});
}

export async function queryDeviceRelationships(
    input: DeviceRelationshipsQueryInput
): Promise<DeviceRelationshipsQueryResponse> {
    const page = await relationshipQueryPage(input);
    const items = await loadPagedRelationshipGraphs({input, page});
    return {
        items,
        nextCursor: page.nextCursor,
        generatedAt: new Date().toISOString(),
        truncated: page.nextCursor !== undefined
    };
}

async function loadPagedRelationshipGraphs(input: {
    input: DeviceRelationshipsQueryInput;
    page: RelationshipQueryPage;
}): Promise<DeviceRelationshipsResponse[]> {
    // Each graph load is independent — serial awaits multiply latency by
    // page size (each load runs 20+ sub-queries).
    return Promise.all(
        input.page.shellyIDs.map((shellyID) =>
            getDeviceRelationships({
                organizationId: input.input.organizationId,
                params: {...input.input.params, shellyID},
                filterAccessibleDevices: input.input.filterAccessibleDevices,
                readableResources: input.input.readableResources,
                permissions: input.input.permissions
            })
        )
    );
}

async function relationshipQueryPage(
    input: DeviceRelationshipsQueryInput
): Promise<RelationshipQueryPage> {
    const accessible = await accessibleQueryDeviceIds(input);
    const offset = relationshipQueryOffset(input.params.cursor);
    const limit = relationshipQueryLimit(input.params.limit);
    return {
        shellyIDs: accessible.slice(offset, offset + limit),
        nextCursor:
            offset + limit < accessible.length
                ? String(offset + limit)
                : undefined
    };
}

interface RelationshipQueryPage {
    shellyIDs: string[];
    nextCursor?: string;
}

async function accessibleQueryDeviceIds(
    input: DeviceRelationshipsQueryInput
): Promise<string[]> {
    const candidates = queryCandidateDeviceIds(input.params.shellyIDs);
    const allowed = input.filterAccessibleDevices
        ? await input.filterAccessibleDevices(candidates)
        : new Set(candidates);
    return candidates.filter((externalId) => allowed.has(externalId));
}

function queryCandidateDeviceIds(shellyIDs: readonly string[] | undefined) {
    return uniqueExternalIds(
        shellyIDs ?? [...DeviceCollector.getAllShellyIDs()]
    );
}

function uniqueExternalIds(externalIds: readonly string[]): string[] {
    return [...new Set(externalIds)].sort((a, b) => a.localeCompare(b));
}

function relationshipQueryOffset(cursor: string | undefined): number {
    if (!cursor) return 0;
    const offset = Number.parseInt(cursor, 10);
    return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

function relationshipQueryLimit(limit: number | undefined): number {
    const maxLimit = Math.max(1, tuning.device.relationshipQueryMaxLimit);
    const defaultLimit = Math.min(
        Math.max(1, tuning.device.relationshipQueryDefaultLimit),
        maxLimit
    );
    if (!limit) return defaultLimit;
    return Math.min(Math.max(1, limit), maxLimit);
}

async function loadGraphFacts(input: {
    input: DeviceRelationshipsInput;
    request: RelationshipGraphRequest;
}): Promise<RelationshipGraphFacts | null> {
    const centerFacts = await loadFactsForCenter({
        input: input.input,
        centerExternalId: input.request.centerExternalId,
        request: input.request
    });
    if (!centerFacts || input.request.depth === 1) return centerFacts;
    return await loadDepthTwoFacts({
        input: input.input,
        request: input.request,
        centerFacts
    });
}

async function loadDepthTwoFacts(input: {
    input: DeviceRelationshipsInput;
    request: RelationshipGraphRequest;
    centerFacts: RelationshipGraphFacts;
}): Promise<RelationshipGraphFacts> {
    const relatedExternalIds = await visibleRelatedDeviceIds({
        input: input.input,
        request: input.request,
        facts: input.centerFacts
    });
    const relatedFacts = await loadRelatedDeviceFacts({
        input: input.input,
        request: input.request,
        relatedExternalIds
    });
    return mergeRelationshipFacts([input.centerFacts, ...relatedFacts]);
}

async function loadRelatedDeviceFacts(input: {
    input: DeviceRelationshipsInput;
    request: RelationshipGraphRequest;
    relatedExternalIds: readonly string[];
}): Promise<RelationshipGraphFacts[]> {
    const loaded = await Promise.all(
        input.relatedExternalIds.map((centerExternalId) =>
            loadFactsForCenter({
                input: input.input,
                centerExternalId,
                request: input.request
            })
        )
    );
    return loaded.filter(
        (facts): facts is RelationshipGraphFacts => facts != null
    );
}

async function visibleRelatedDeviceIds(input: {
    input: DeviceRelationshipsInput;
    request: RelationshipGraphRequest;
    facts: RelationshipGraphFacts;
}): Promise<string[]> {
    const candidates = directRelatedDeviceIds({
        centerExternalId: input.request.centerExternalId,
        facts: input.facts
    });
    const allowed = input.input.filterAccessibleDevices
        ? await input.input.filterAccessibleDevices(candidates)
        : new Set(candidates);
    return candidates
        .filter((externalId) => allowed.has(externalId))
        .slice(0, tuning.device.relationshipDepthTwoMaxExpansions);
}

function directRelatedDeviceIds(input: {
    centerExternalId: string;
    facts: RelationshipGraphFacts;
}): string[] {
    const ids = new Set<string>();
    for (const fact of input.facts.devices) {
        if (fact.externalId !== input.centerExternalId)
            ids.add(fact.externalId);
    }
    addServesDeviceIds(ids, input.facts);
    addVirtualBindingDeviceIds(ids, input.facts);
    addBluetoothTransportDeviceIds(ids, input.facts);
    addExtractionDeviceIds(ids, input.facts);
    addDashboardDeviceIds(ids, input.facts);
    addAutomationDeviceIds(ids, input.facts);
    addOperationDeviceIds(ids, input.facts);
    ids.delete(input.centerExternalId);
    return [...ids].sort((a, b) => a.localeCompare(b));
}

function addServesDeviceIds(
    ids: Set<string>,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.servesLinks) {
        if (fact.source.kind === 'device') ids.add(fact.source.id);
        if (fact.target.kind === 'device') ids.add(fact.target.id);
    }
}

function addVirtualBindingDeviceIds(
    ids: Set<string>,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.virtualBindings) {
        ids.add(fact.virtualExternalId);
        ids.add(fact.sourceExternalId);
    }
}

function addBluetoothTransportDeviceIds(
    ids: Set<string>,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.bluetoothTransports) {
        ids.add(fact.bluetoothExternalId);
        if (fact.gatewayExternalId) ids.add(fact.gatewayExternalId);
    }
}

function addExtractionDeviceIds(
    ids: Set<string>,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.extractionOrigins) {
        ids.add(fact.extractedExternalId);
        ids.add(fact.sourceHostExternalId);
    }
}

function addDashboardDeviceIds(
    ids: Set<string>,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.dashboardItems) {
        if (fact.targetExternalId) ids.add(fact.targetExternalId);
    }
}

function addAutomationDeviceIds(
    ids: Set<string>,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.automationFlows) {
        for (const externalId of fact.targetExternalIds) ids.add(externalId);
    }
    for (const fact of facts.automationNodes) {
        for (const externalId of fact.targetExternalIds) ids.add(externalId);
    }
}

function addOperationDeviceIds(
    ids: Set<string>,
    facts: RelationshipGraphFacts
): void {
    for (const fact of facts.operationJobs) ids.add(fact.targetExternalId);
    for (const fact of facts.operationUnits) ids.add(fact.targetExternalId);
}

async function loadFactsForCenter(input: {
    input: DeviceRelationshipsInput;
    centerExternalId: string;
    request: RelationshipGraphRequest;
}): Promise<RelationshipGraphFacts | null> {
    return await loadRelationshipFacts({
        organizationId: input.input.organizationId,
        centerExternalId: input.centerExternalId,
        includes: input.request.includes,
        permissions: input.input.permissions,
        readableResources: input.input.readableResources,
        filterAccessibleDevices: input.input.filterAccessibleDevices
    });
}

function mergeRelationshipFacts(
    factsList: readonly RelationshipGraphFacts[]
): RelationshipGraphFacts {
    const [first] = factsList;
    if (!first) {
        throw RpcError.OperationFailed('device.Relationships.Get');
    }
    return {
        centerExternalId: first.centerExternalId,
        devices: factsList.flatMap((facts) => facts.devices),
        components: factsList.flatMap((facts) => facts.components),
        entities: factsList.flatMap((facts) => facts.entities),
        memberships: factsList.flatMap((facts) => facts.memberships),
        membershipHierarchies: factsList.flatMap(
            (facts) => facts.membershipHierarchies
        ),
        visualAssets: factsList.flatMap((facts) => facts.visualAssets),
        costCenters: factsList.flatMap((facts) => facts.costCenters),
        servesLinks: factsList.flatMap((facts) => facts.servesLinks),
        profileReferences: factsList.flatMap(
            (facts) => facts.profileReferences
        ),
        extractionOrigins: factsList.flatMap(
            (facts) => facts.extractionOrigins
        ),
        virtualRoles: factsList.flatMap((facts) => facts.virtualRoles),
        virtualBindings: factsList.flatMap((facts) => facts.virtualBindings),
        bluetoothTransports: factsList.flatMap(
            (facts) => facts.bluetoothTransports
        ),
        alertRules: factsList.flatMap((facts) => facts.alertRules),
        alertDestinations: factsList.flatMap(
            (facts) => facts.alertDestinations
        ),
        maintenanceWindows: factsList.flatMap(
            (facts) => facts.maintenanceWindows
        ),
        routingPolicies: factsList.flatMap((facts) => facts.routingPolicies),
        destinationGroups: factsList.flatMap(
            (facts) => facts.destinationGroups
        ),
        notificationChannels: factsList.flatMap(
            (facts) => facts.notificationChannels
        ),
        onCallSchedules: factsList.flatMap((facts) => facts.onCallSchedules),
        dashboardItems: factsList.flatMap((facts) => facts.dashboardItems),
        automationFlows: factsList.flatMap((facts) => facts.automationFlows),
        automationNodes: factsList.flatMap((facts) => facts.automationNodes),
        energyClassifications: factsList.flatMap(
            (facts) => facts.energyClassifications
        ),
        operationJobs: factsList.flatMap((facts) => facts.operationJobs),
        operationUnits: factsList.flatMap((facts) => facts.operationUnits),
        controls: factsList.flatMap((facts) => facts.controls),
        credentialStates: factsList.flatMap((facts) => facts.credentialStates),
        certificates: factsList.flatMap((facts) => facts.certificates),
        assignmentGrants: factsList.flatMap((facts) => facts.assignmentGrants),
        connectorPoints: factsList.flatMap((facts) => facts.connectorPoints),
        deviceSubresources: factsList.flatMap(
            (facts) => facts.deviceSubresources
        ),
        externalConnections: factsList.flatMap(
            (facts) => facts.externalConnections
        ),
        historyEvents: factsList.flatMap((facts) => facts.historyEvents),
        summaries: factsList.flatMap((facts) => facts.summaries)
    };
}

function buildGraphRequest(
    params: DeviceRelationshipsGetParams
): RelationshipGraphRequest {
    assertSupportedDepth(params.depth ?? 1);
    return {
        centerExternalId: params.shellyID,
        depth: params.depth ?? 1,
        direction: params.direction ?? 'both',
        includes: relationshipIncludes(params.include),
        generatedAt: new Date().toISOString()
    };
}

function relationshipIncludes(
    include: DeviceRelationshipInclude[] | undefined
): ReadonlySet<DeviceRelationshipInclude> {
    return new Set(include ?? DEVICE_RELATIONSHIP_DEFAULT_INCLUDES);
}

function assertSupportedDepth(depth: number): void {
    if (depth === 1 || depth === 2) return;
    throw RpcError.InvalidParams(
        'device.Relationships.Get supports depth=1 or depth=2'
    );
}
