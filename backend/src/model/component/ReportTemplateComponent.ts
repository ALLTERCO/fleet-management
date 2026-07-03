// reporttemplate.* — save, list, fetch, and delete named report configurations.

import {incrementLabeledCounter} from '../../modules/Observability';
import {
    createReportTemplate,
    deleteReportTemplate,
    getReportTemplate,
    listReportTemplates,
    reportTemplateNameExists,
    updateReportTemplate
} from '../../modules/reportTemplateRepository';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    REPORT_GENERATE_ENERGY_PARAMS_SCHEMA,
    REPORT_GENERATE_PARAMS_SCHEMA
} from '../../types/api/report';
import {
    REPORT_TEMPLATE_CREATE_PARAMS_SCHEMA,
    REPORT_TEMPLATE_DELETE_PARAMS_SCHEMA,
    REPORT_TEMPLATE_DESCRIBE,
    REPORT_TEMPLATE_GET_PARAMS_SCHEMA,
    REPORT_TEMPLATE_LIST_PARAMS_SCHEMA,
    REPORT_TEMPLATE_RUN_PARAMS_SCHEMA,
    REPORT_TEMPLATE_UPDATE_PARAMS_SCHEMA,
    type ReportTemplateCreateParams,
    type ReportTemplateDeleteParams,
    type ReportTemplateGetParams,
    type ReportTemplateKind,
    type ReportTemplateRunParams,
    type ReportTemplateUpdateParams
} from '../../types/api/reporttemplate';
import type CommandSender from '../CommandSender';
import {startReportJob} from '../report/reportJobService';
import {templateReportRequest} from '../report/templateReportRequest';
import Component from './Component';

function requireOrg(sender: CommandSender): string {
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    return orgId;
}

// The report request schema a template's params must validate against, by kind.
// interval uses the generic report request; energy has its own.
function paramSchemaFor(kind: ReportTemplateKind) {
    return kind === 'energy'
        ? REPORT_GENERATE_ENERGY_PARAMS_SCHEMA
        : REPORT_GENERATE_PARAMS_SCHEMA;
}

// Single source of truth for the duplicate-name rejection.
function nameTakenError(name: string): RpcError {
    return RpcError.InvalidParams(
        `A report template named '${name}' already exists`
    );
}

// Collaborators, injectable so the orchestration is testable without a database
// or the report engine. Production wires the real repository + job entrypoint.
export interface ReportTemplateDeps {
    create: typeof createReportTemplate;
    update: typeof updateReportTemplate;
    remove: typeof deleteReportTemplate;
    get: typeof getReportTemplate;
    list: typeof listReportTemplates;
    nameExists: typeof reportTemplateNameExists;
    startJob: typeof startReportJob;
}

const PRODUCTION_DEPS: ReportTemplateDeps = {
    create: createReportTemplate,
    update: updateReportTemplate,
    remove: deleteReportTemplate,
    get: getReportTemplate,
    list: listReportTemplates,
    nameExists: reportTemplateNameExists,
    startJob: startReportJob
};

export default class ReportTemplateComponent extends Component {
    readonly #deps: ReportTemplateDeps;

    constructor(deps: ReportTemplateDeps = PRODUCTION_DEPS) {
        super('reporttemplate', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
        this.#deps = deps;
    }

    // Insert, translating a unique-name race (23505) into a clean error so the
    // caller's flow stays free of error-handling noise.
    async #insert(
        orgId: string,
        input: ReportTemplateCreateParams & {createdBy: string | null}
    ) {
        try {
            return await this.#deps.create(orgId, input);
        } catch (err) {
            if ((err as {code?: string}).code === '23505') {
                throw nameTakenError(input.name);
            }
            throw err;
        }
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return REPORT_TEMPLATE_DESCRIBE;
    }

    @Component.Expose('Create')
    @Component.CrudPermission('reports', 'update')
    async create(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<ReportTemplateCreateParams>(
            params,
            REPORT_TEMPLATE_CREATE_PARAMS_SCHEMA
        );
        // The saved params must be a valid, re-runnable request for the kind.
        validateOrThrow(p.params, paramSchemaFor(p.kind));
        const orgId = requireOrg(sender);
        if (await this.#deps.nameExists(orgId, p.name)) {
            throw nameTakenError(p.name);
        }
        const created = await this.#insert(orgId, {
            ...p,
            createdBy: sender.getUserId() ?? null
        });
        incrementLabeledCounter('fm_report_template_created', {kind: p.kind});
        return created;
    }

    @Component.Expose('Update')
    @Component.CrudPermission('reports', 'update')
    async update(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<ReportTemplateUpdateParams>(
            params,
            REPORT_TEMPLATE_UPDATE_PARAMS_SCHEMA
        );
        const orgId = requireOrg(sender);
        const existing = await this.#deps.get(orgId, p.id);
        if (!existing) throw RpcError.NotFound('report_template', p.id);
        // New params (if any) must still be a valid request for this kind.
        if (p.params !== undefined) {
            validateOrThrow(p.params, paramSchemaFor(existing.kind));
        }
        if (
            p.name !== undefined &&
            p.name.toLowerCase() !== existing.name.toLowerCase() &&
            (await this.#deps.nameExists(orgId, p.name))
        ) {
            throw nameTakenError(p.name);
        }
        const updated = await this.#deps.update(orgId, p.id, {
            name: p.name,
            description: p.description,
            params: p.params,
            sectionsEnabled: p.sectionsEnabled
        });
        if (!updated) throw RpcError.NotFound('report_template', p.id);
        return updated;
    }

    @Component.Expose('List')
    @Component.CrudPermission('reports', 'read')
    async list(params: unknown, sender: CommandSender) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            REPORT_TEMPLATE_LIST_PARAMS_SCHEMA
        );
        return {templates: await this.#deps.list(requireOrg(sender))};
    }

    @Component.Expose('Get')
    @Component.CrudPermission('reports', 'read')
    async get(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<ReportTemplateGetParams>(
            params,
            REPORT_TEMPLATE_GET_PARAMS_SCHEMA
        );
        const template = await this.#deps.get(requireOrg(sender), p.id);
        if (!template) throw RpcError.NotFound('report_template', p.id);
        return template;
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('reports', 'update')
    async delete(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<ReportTemplateDeleteParams>(
            params,
            REPORT_TEMPLATE_DELETE_PARAMS_SCHEMA
        );
        if (!(await this.#deps.remove(requireOrg(sender), p.id))) {
            throw RpcError.NotFound('report_template', p.id);
        }
        return {deleted: true};
    }

    @Component.Expose('Run')
    @Component.CrudPermission('reports', 'update')
    @Component.RateLimit('expensive')
    async run(params: unknown, sender: CommandSender) {
        const p = validateOrThrow<ReportTemplateRunParams>(
            params,
            REPORT_TEMPLATE_RUN_PARAMS_SCHEMA
        );
        const template = await this.#deps.get(requireOrg(sender), p.id);
        if (!template) throw RpcError.NotFound('report_template', p.id);
        incrementLabeledCounter('fm_report_template_run', {
            kind: template.kind
        });
        // Route through the one report entrypoint: start a job from the saved
        // request and return its id. The caller polls report.GetReport.
        return this.#deps.startJob(templateReportRequest(template), sender);
    }
}
