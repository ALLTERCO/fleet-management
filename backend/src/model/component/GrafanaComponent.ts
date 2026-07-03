import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CFG_FOLDER} from '../../config';
import {findDashboardBySlug} from '../../config/grafanaApi';
import {canUseAuthenticatedRead} from '../../modules/authz/evaluator';
import type {DescribeOutput} from '../../rpc/describe';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    GRAFANA_DESCRIBE,
    GRAFANA_GET_CONFIG_PARAMS_SCHEMA,
    GRAFANA_GET_DASHBOARD_PARAMS_SCHEMA
} from '../../types/api/grafana';
import Component from './Component';

export default class GrafanaComponent extends Component<NonNullable<any>> {
    constructor() {
        super('grafana', {
            set_config_methods: false,
            auto_apply_config: false,
            viewer_visible: true
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return GRAFANA_DESCRIBE;
    }

    @Component.Expose('GetConfig')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    public override async getConfig(params?: unknown) {
        validateOrThrow<Record<string, never>>(
            params ?? {},
            GRAFANA_GET_CONFIG_PARAMS_SCHEMA
        );
        const filePath = join(CFG_FOLDER, 'grafana', 'config.json');
        try {
            return JSON.parse(await readFile(filePath, 'utf-8'));
        } catch (err: any) {
            if (err?.code === 'ENOENT') return {};
            throw err;
        }
    }

    @Component.Expose('GetDashboard')
    @Component.CheckPermissions(canUseAuthenticatedRead)
    public async getDashboard(params: unknown) {
        const v = validateOrThrow<{slug: string}>(
            params,
            GRAFANA_GET_DASHBOARD_PARAMS_SCHEMA
        );
        return findDashboardBySlug(await this.getConfig(), v.slug);
    }

    protected override getDefaultConfig() {
        return {};
    }
}
