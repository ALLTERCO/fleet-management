import {getBillActual} from '../../modules/billActualsRepository';
import * as PostgresProvider from '../../modules/PostgresProvider';
import type {ReportSectionId} from '../../types/api/reporttemplate';
import {
    type AllocationTarget,
    allocateFleetCost,
    appendBillReconciliationRows,
    appendCostAllocationRows,
    appendRoleGatedRows,
    currencySymbol,
    energyRow,
    expandGroupTargets,
    servesByDevice,
    shellyIDsByRole
} from './energyEngineHelpers';
import type {TimeSeriesAggregation} from './energyReportAggregation';

interface ExtendedSectionsRequest {
    rows: Record<string, any>[];
    orgId: string;
    shellyIDs: readonly string[];
    tsRows: TimeSeriesAggregation['tsRows'];
    deviceAgg: TimeSeriesAggregation['deviceAgg'];
    deviceMap: Map<number, string>;
    totalCost: number;
    tariff: number;
    currency: string;
    from: string;
    to: string;
    timezone: string | null;
    allowedSections?: readonly ReportSectionId[] | null;
}

export async function appendEnergyExtendedSections(
    request: ExtendedSectionsRequest
): Promise<void> {
    await appendRoleSections(request);
    await appendCostSections(request);
    await appendBillSection(request);
}

async function appendRoleSections(
    request: ExtendedSectionsRequest
): Promise<void> {
    appendRoleGatedRows(request.rows, energyRow, {
        roles: await shellyIDsByRole(
            request.orgId,
            request.shellyIDs,
            request.deviceMap
        ),
        tsRows: request.tsRows,
        deviceAgg: request.deviceAgg,
        deviceMap: request.deviceMap,
        tariff: request.tariff,
        currencySymbol: currencySymbol(request.currency),
        allowedSections: request.allowedSections
    });
}

async function appendCostSections(
    request: ExtendedSectionsRequest
): Promise<void> {
    const serves = await servesByDevice(request.orgId, request.shellyIDs);
    const allocation = allocateFleetCost({
        deviceAgg: request.deviceAgg,
        deviceMap: request.deviceMap,
        serves
    });
    appendCostAllocationRows(
        request.rows,
        energyRow,
        {
            perTarget: await expandServedGroups(
                request.orgId,
                allocation.perTarget
            ),
            unallocated: allocation.unallocated
        },
        currencySymbol(request.currency)
    );
}

async function appendBillSection(
    request: ExtendedSectionsRequest
): Promise<void> {
    appendBillReconciliationRows(request.rows, energyRow, {
        reportCost: request.totalCost,
        actual: await getBillActual(
            request.orgId,
            request.from,
            request.to,
            request.timezone
        ),
        currency: currencySymbol(request.currency)
    });
}

async function expandServedGroups(
    orgId: string,
    perTarget: Map<string, AllocationTarget>
): Promise<Map<string, AllocationTarget>> {
    const groupIds = [...perTarget.values()]
        .filter((target) => target.targetType === 'group')
        .map((target) => target.targetId);
    if (groupIds.length === 0) return perTarget;

    const memberships = await PostgresProvider.listGroupDeviceMemberships(
        orgId,
        groupIds.map(Number).filter(Number.isInteger)
    );
    return expandGroupTargets(perTarget, groupMembersById(memberships));
}

function groupMembersById(
    memberships: ReadonlyArray<{group_id: number | string; subject_id: string}>
): Map<string, string[]> {
    const groupMembers = new Map<string, string[]>();
    for (const member of memberships) {
        const key = String(member.group_id);
        const list = groupMembers.get(key) ?? [];
        list.push(member.subject_id);
        groupMembers.set(key, list);
    }
    return groupMembers;
}
