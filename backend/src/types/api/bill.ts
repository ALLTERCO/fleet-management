// bill.* — record and read actual utility-bill amounts per billing period, for
// report-vs-bill reconciliation (the energy report compares its computed cost
// to the recorded actual).

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const PERM_READ = {component: 'reports', operation: 'read' as const};
const PERM_WRITE = {component: 'reports', operation: 'update' as const};

const DATE_SCHEMA: JsonSchema = {
    type: 'string',
    pattern: '^\\d{4}-\\d{2}-\\d{2}$'
};
const CURRENCY_SCHEMA: JsonSchema = {type: 'string', pattern: '^[A-Z]{3}$'};

const BILL_ENTRY_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['id', 'periodStart', 'periodEnd', 'actualCost', 'currency'],
    additionalProperties: false,
    properties: {
        id: {type: 'number'},
        periodStart: {type: 'string'},
        periodEnd: {type: 'string'},
        actualCost: {type: 'number'},
        currency: {type: 'string'}
    }
};

export interface BillSetParams {
    periodStart: string;
    periodEnd: string;
    actualCost: number;
    currency?: string;
}
export const BILL_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['periodStart', 'periodEnd', 'actualCost'],
    additionalProperties: false,
    properties: {
        periodStart: DATE_SCHEMA,
        periodEnd: DATE_SCHEMA,
        actualCost: {type: 'number', minimum: 0},
        currency: CURRENCY_SCHEMA
    }
};

export interface BillListParams {
    from?: string;
    to?: string;
}
export const BILL_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {from: DATE_SCHEMA, to: DATE_SCHEMA}
};

export interface BillDeleteParams {
    id: number;
}
export const BILL_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: {type: 'number'}}
};

const b = new DescribeBuilder('bill', {
    kind: 'fleet-manager',
    description:
        'Record and read actual utility-bill amounts for report reconciliation.'
});

b.registerMethod('Set', {
    params: BILL_SET_PARAMS_SCHEMA,
    response: BILL_ENTRY_RESPONSE,
    permission: PERM_WRITE,
    description: 'Record (upsert) the actual bill for a billing period.'
});
b.registerMethod('List', {
    params: BILL_LIST_PARAMS_SCHEMA,
    response: {type: 'object', description: 'bills: array of bill entries'},
    permission: PERM_READ,
    description: 'List recorded bills, optionally within a date range.'
});
b.registerMethod('Delete', {
    params: BILL_DELETE_PARAMS_SCHEMA,
    response: {type: 'object', description: '{deleted: true} on success'},
    permission: PERM_WRITE,
    description: 'Delete a recorded bill.'
});

export const BILL_DESCRIBE: DescribeOutput = b.build();
