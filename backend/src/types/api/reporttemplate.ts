// reporttemplate.* — saved, named report configurations an org re-runs with one
// click. params is a stored report request, validated against the schema for its
// kind; Run feeds it to the one report entrypoint (report.Generate). kind is one
// of the entrypoint's two. sectionsEnabled allowlists the role-gated sections
// (demand/solar/battery/ev/tenant) for energy reports; null/empty = no
// restriction, and core sections always render.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const PERM_READ = {component: 'reports', operation: 'read' as const};
const PERM_WRITE = {component: 'reports', operation: 'update' as const};

export const REPORT_TEMPLATE_KINDS = ['energy', 'interval'] as const;
export type ReportTemplateKind = (typeof REPORT_TEMPLATE_KINDS)[number];

// Role-gated section ids. Single source of truth for the vocabulary; the engine
// routing table (sectionDispatch) imports the type from here.
export const REPORT_SECTION_IDS = [
    'demand',
    'solar',
    'battery',
    'ev',
    'tenant'
] as const;
export type ReportSectionId = (typeof REPORT_SECTION_IDS)[number];

const SECTIONS_SCHEMA: JsonSchema = {
    type: 'array',
    items: {type: 'string', enum: [...REPORT_SECTION_IDS]},
    uniqueItems: true,
    description:
        'Allowlist for the role-gated sections only. Empty/null renders all ' +
        'triggered sections; core sections are always included.'
};

export interface ReportTemplate {
    id: string;
    name: string;
    description: string | null;
    kind: ReportTemplateKind;
    params: Record<string, unknown>;
    sectionsEnabled: string[] | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string | null;
}

export interface ReportTemplateCreateParams {
    name: string;
    description?: string | null;
    kind: ReportTemplateKind;
    params: Record<string, unknown>;
    sectionsEnabled?: string[] | null;
}
export const REPORT_TEMPLATE_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name', 'kind', 'params'],
    additionalProperties: false,
    properties: {
        name: {type: 'string', minLength: 1, maxLength: 120},
        description: {
            anyOf: [{type: 'string', maxLength: 500}, {type: 'null'}]
        },
        kind: {type: 'string', enum: [...REPORT_TEMPLATE_KINDS]},
        params: {type: 'object'},
        sectionsEnabled: {anyOf: [SECTIONS_SCHEMA, {type: 'null'}]}
    }
};

export const REPORT_TEMPLATE_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export interface ReportTemplateGetParams {
    id: string;
}
export const REPORT_TEMPLATE_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {id: {type: 'string', format: 'uuid'}}
};
export type ReportTemplateDeleteParams = ReportTemplateGetParams;
export const REPORT_TEMPLATE_DELETE_PARAMS_SCHEMA =
    REPORT_TEMPLATE_GET_PARAMS_SCHEMA;

export interface ReportTemplateUpdateParams {
    id: string;
    name?: string;
    description?: string | null;
    params?: Record<string, unknown>;
    sectionsEnabled?: string[] | null;
}
export const REPORT_TEMPLATE_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: {
        id: {type: 'string', format: 'uuid'},
        name: {type: 'string', minLength: 1, maxLength: 120},
        description: {
            anyOf: [{type: 'string', maxLength: 500}, {type: 'null'}]
        },
        params: {type: 'object'},
        sectionsEnabled: {anyOf: [SECTIONS_SCHEMA, {type: 'null'}]}
    }
};

export interface ReportTemplateRunParams {
    id: string;
}
export const REPORT_TEMPLATE_RUN_PARAMS_SCHEMA =
    REPORT_TEMPLATE_GET_PARAMS_SCHEMA;

const REPORT_TEMPLATE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['id', 'name', 'kind', 'params', 'createdAt'],
    additionalProperties: true,
    properties: {
        id: {type: 'string'},
        name: {type: 'string'},
        description: {type: ['string', 'null']},
        kind: {type: 'string'},
        params: {type: 'object'},
        sectionsEnabled: {anyOf: [{type: 'array'}, {type: 'null'}]},
        createdBy: {type: ['string', 'null']},
        createdAt: {type: 'string'},
        updatedAt: {type: ['string', 'null']}
    }
};

const b = new DescribeBuilder('reporttemplate', {
    kind: 'fleet-manager',
    description: 'Saved, named report configurations an org can re-run.'
});

b.registerMethod('Create', {
    params: REPORT_TEMPLATE_CREATE_PARAMS_SCHEMA,
    response: REPORT_TEMPLATE_RESPONSE,
    permission: PERM_WRITE,
    description: 'Save a named report template.'
});
b.registerMethod('List', {
    params: REPORT_TEMPLATE_LIST_PARAMS_SCHEMA,
    response: {type: 'object', description: 'templates: array of templates'},
    permission: PERM_READ,
    description: "List the caller org's report templates."
});
b.registerMethod('Get', {
    params: REPORT_TEMPLATE_GET_PARAMS_SCHEMA,
    response: REPORT_TEMPLATE_RESPONSE,
    permission: PERM_READ,
    description: 'Fetch a single report template.'
});
b.registerMethod('Update', {
    params: REPORT_TEMPLATE_UPDATE_PARAMS_SCHEMA,
    response: REPORT_TEMPLATE_RESPONSE,
    permission: PERM_WRITE,
    description: 'Patch a report template (name/description/params/sections).'
});
b.registerMethod('Delete', {
    params: REPORT_TEMPLATE_DELETE_PARAMS_SCHEMA,
    response: {type: 'object', description: '{deleted: true} on success'},
    permission: PERM_WRITE,
    description: 'Delete a report template.'
});
b.registerMethod('Run', {
    params: REPORT_TEMPLATE_RUN_PARAMS_SCHEMA,
    response: {
        type: 'object',
        description: '{jobId, status} — poll report.GetReport for the file'
    },
    permission: PERM_WRITE,
    description:
        "Run a template's saved report via report.Generate; returns a jobId."
});

export const REPORT_TEMPLATE_DESCRIBE: DescribeOutput = b.build();
