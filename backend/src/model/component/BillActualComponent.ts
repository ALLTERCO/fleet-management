// bill.* — record/read/delete actual utility bills for report reconciliation.

import {requireTenantWideComponentPermission} from '../../modules/authz/evaluator';
import {
    assertUniqueBillImportIdentities,
    billListRangeError,
    deleteBillActual,
    importBillActuals,
    isRealCalendarDate,
    listBillActuals,
    setBillActual
} from '../../modules/billActualsRepository';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    BILL_DELETE_PARAMS_SCHEMA,
    BILL_DESCRIBE,
    BILL_IMPORT_PARAMS_SCHEMA,
    BILL_LIST_PARAMS_SCHEMA,
    BILL_QUOTE_PARAMS_SCHEMA,
    BILL_SET_PARAMS_SCHEMA,
    type BillDeleteParams,
    type BillImportParams,
    type BillListParams,
    type BillQuoteParams,
    type BillSetParams
} from '../../types/api/bill';
import {calculateBillingQuote} from '../billing/billingQuote';
import type CommandSender from '../CommandSender';
import Component from './Component';

function requireOrg(sender: CommandSender): string {
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    return orgId;
}

// A bill is not a report: no scope selector names it.
const NOT_A_REPORT_ID = (): undefined => undefined;

export default class BillActualComponent extends Component {
    constructor() {
        super('bill', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return BILL_DESCRIBE;
    }

    @Component.Expose('Set')
    @Component.CrudPermission('reports', 'update')
    async set(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<BillSetParams>(
            params,
            BILL_SET_PARAMS_SCHEMA
        );
        validatePeriod(p);
        return setBillActual(requireOrg(sender), p);
    }

    @Component.Expose('List')
    @Component.CrudPermission('reports', 'read')
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<BillListParams>(
            params ?? {},
            BILL_LIST_PARAMS_SCHEMA
        );
        const rangeError = billListRangeError(p);
        if (rangeError) throw RpcError.InvalidParams(rangeError);
        return listBillActuals(requireOrg(sender), p);
    }

    @Component.Expose('Import')
    @Component.CrudPermission('reports', 'update')
    @Component.RateLimit('expensive')
    async import(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<BillImportParams>(
            params,
            BILL_IMPORT_PARAMS_SCHEMA
        );
        for (const bill of p.bills) validatePeriod(bill);
        try {
            assertUniqueBillImportIdentities(p.bills);
        } catch (error) {
            throw RpcError.InvalidParams((error as Error).message);
        }
        return {bills: await importBillActuals(requireOrg(sender), p.bills)};
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('reports', 'update', NOT_A_REPORT_ID)
    async delete(params: unknown, sender: CommandSender) {
        await requireTenantWideComponentPermission(sender, 'reports', 'update');
        const p = validateOrThrow<BillDeleteParams>(
            params,
            BILL_DELETE_PARAMS_SCHEMA
        );
        if (!(await deleteBillActual(requireOrg(sender), p.id))) {
            throw RpcError.NotFound('bill', String(p.id));
        }
        return {deleted: true};
    }

    @Component.Expose('Quote')
    @Component.NoPermissions
    @Component.RateLimit('billing')
    async quote(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<BillQuoteParams>(
            params,
            BILL_QUOTE_PARAMS_SCHEMA
        );
        return calculateBillingQuote(p, sender);
    }
}

function validatePeriod(params: BillSetParams): void {
    if (
        !isRealCalendarDate(params.periodStart) ||
        !isRealCalendarDate(params.periodEnd)
    ) {
        throw RpcError.InvalidParams(
            'periodStart and periodEnd must be real calendar dates'
        );
    }
    if (params.periodEnd < params.periodStart) {
        throw RpcError.InvalidParams(
            'periodEnd must be on or after periodStart'
        );
    }
}
