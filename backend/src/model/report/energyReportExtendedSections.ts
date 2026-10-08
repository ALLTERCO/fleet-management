import {resolveBillActualForReport} from '../../modules/billActualsRepository';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {currencyFractionDigits} from '../../types/api/_currency';
import type {BillReconciliationSelector} from '../../types/api/bill';
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
import type {BillChargeSummary} from './energyReportBillChargeTypes';
import {appendEvDeliveredEnergySection} from './energyReportEv';
import type {LogicalMeterBreakdown} from './logicalMeterUsage';
import type {TariffDemandDeviceSample} from './tariffDemandCharges';

interface ExtendedSectionsRequest {
    rows: ReturnType<typeof energyRow>[];
    orgId: string;
    shellyIDs: readonly string[];
    tsRows: TimeSeriesAggregation['tsRows'];
    devicePeakW: ReadonlyMap<number, number>;
    deviceAgg: TimeSeriesAggregation['deviceAgg'];
    deviceMap: Map<number, string>;
    masterEnergyCost: number;
    billCharges: BillChargeSummary | null;
    demandDeviceSamples: readonly TariffDemandDeviceSample[];
    meterBreakdown: LogicalMeterBreakdown | null;
    shadowBillCost: number | null;
    tariff: number;
    currency: string;
    from: string;
    to: string;
    timezone: string | null;
    billIdentity?: BillReconciliationSelector;
    /** True only when the report selector covers the organization, not a scope. */
    organizationLevel: boolean;
    allowedSections?: readonly ReportSectionId[] | null;
}

export async function appendEnergyExtendedSections(
    request: ExtendedSectionsRequest
): Promise<void> {
    await appendRoleSections(request);
    appendEvDeliveredEnergySection({
        rows: request.rows,
        breakdown: request.meterBreakdown,
        allowedSections: request.allowedSections
    });
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
            request.deviceMap,
            undefined,
            new Date(request.from)
        ),
        tsRows: request.tsRows,
        devicePeakW: request.devicePeakW,
        deviceAgg: request.deviceAgg,
        deviceMap: request.deviceMap,
        tariff: request.tariff,
        currencySymbol: currencySymbol(request.currency),
        currencyFractionDigits: currencyFractionDigits(request.currency),
        masterEnergyCost: request.masterEnergyCost,
        billCharges: request.billCharges,
        demandDeviceSamples: request.demandDeviceSamples,
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
    let unavailableReason = billComparisonUnavailableReason(request);
    const resolution = unavailableReason
        ? null
        : await resolveBillActualForReport(
              request.orgId,
              request.from,
              request.to,
              request.timezone,
              request.billIdentity
          );
    if (resolution?.status === 'ambiguous') {
        unavailableReason =
            'multiple recorded bills match this period; select a utility account, meter, or service point';
    }
    if (resolution?.status === 'evidence_mismatch') {
        unavailableReason = `recorded bill identity evidence does not match: ${resolution.fields.join(', ')}`;
    }
    appendBillReconciliationRows(request.rows, energyRow, {
        reportCost: request.shadowBillCost ?? 0,
        actual: resolution?.status === 'matched' ? resolution.bill : null,
        currency: request.currency,
        unavailableReason,
        coverageWarning:
            resolution?.status === 'matched' &&
            !hasIdentityEvidence(request.billIdentity) &&
            resolution.bill.utilityAccountId === null &&
            resolution.bill.meterIdentifier === null &&
            resolution.bill.servicePointIdentifier === null
                ? 'this legacy bill has no utility-account, meter, or service-point identity to verify coverage'
                : null
    });
}

function hasIdentityEvidence(
    selector: BillReconciliationSelector | undefined
): boolean {
    return Boolean(
        selector?.utilityAccountId ??
            selector?.meterIdentifier ??
            selector?.servicePointIdentifier
    );
}

function billComparisonUnavailableReason(
    request: ExtendedSectionsRequest
): string | null {
    if (!request.organizationLevel) {
        return 'the platform shadow bill covers a selected device scope, but recorded bills are organization-level';
    }
    if (request.shadowBillCost === null) {
        return 'the platform shadow bill is incomplete, so a variance would be misleading';
    }
    return null;
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
