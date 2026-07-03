// bill.* — record/read/delete actual utility bills for report reconciliation.

import {
    deleteBillActual,
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
    BILL_LIST_PARAMS_SCHEMA,
    BILL_SET_PARAMS_SCHEMA,
    type BillDeleteParams,
    type BillListParams,
    type BillSetParams
} from '../../types/api/bill';
import type CommandSender from '../CommandSender';
import Component from './Component';

function requireOrg(sender: CommandSender): string {
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    return orgId;
}

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
        if (
            !isRealCalendarDate(p.periodStart) ||
            !isRealCalendarDate(p.periodEnd)
        ) {
            throw RpcError.InvalidParams(
                'periodStart and periodEnd must be real calendar dates'
            );
        }
        if (p.periodEnd < p.periodStart) {
            throw RpcError.InvalidParams(
                'periodEnd must be on or after periodStart'
            );
        }
        return setBillActual(requireOrg(sender), p);
    }

    @Component.Expose('List')
    @Component.CrudPermission('reports', 'read')
    async list(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<BillListParams>(
            params ?? {},
            BILL_LIST_PARAMS_SCHEMA
        );
        return {bills: await listBillActuals(requireOrg(sender), p)};
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('reports', 'update')
    async delete(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<BillDeleteParams>(
            params,
            BILL_DELETE_PARAMS_SCHEMA
        );
        if (!(await deleteBillActual(requireOrg(sender), p.id))) {
            throw RpcError.NotFound('bill', String(p.id));
        }
        return {deleted: true};
    }
}
