/**
 * Tariff namespace — org-level electricity tariff library.
 *
 * Registers `Tariff.List/Get/Add/Update/Delete/Assign`. Heavy lifting lives
 * in `model/tariff/tariffHandlers.ts` as pure functions — this component is
 * a thin adapter so handlers can be unit-tested without the Component graph.
 */

import {requireTenantWideComponentPermission} from '../../modules/authz/evaluator';
import {
    defaultLiveTariffRepository,
    type LiveTariffRepository
} from '../../modules/repositories/LiveTariffRepository.js';
import {
    defaultTariffRepository,
    type TariffRepository
} from '../../modules/repositories/TariffRepository.js';
import type {DescribeOutput} from '../../rpc/describe.js';
import {TARIFF_DESCRIBE} from '../../types/api/tariff.js';
import type CommandSender from '../CommandSender.js';
import * as TariffHandlers from '../tariff/tariffHandlers';
import Component from './Component.js';

// A tariff is not a report: no scope selector names it.
const NOT_A_REPORT_ID = (): undefined => undefined;

// Add with an id overwrites that tariff, so it needs what Update needs.
function namesExistingTariff(params: unknown): boolean {
    return typeof params === 'object' && params !== null && 'id' in params;
}

export default class TariffComponent extends Component {
    readonly #repoOverride?: TariffRepository;
    readonly #liveRepoOverride?: LiveTariffRepository;

    constructor(
        repoOverride?: TariffRepository,
        liveRepoOverride?: LiveTariffRepository
    ) {
        super('tariff', {set_config_methods: false, auto_apply_config: false});
        this.#repoOverride = repoOverride;
        this.#liveRepoOverride = liveRepoOverride;
    }

    async #repo(): Promise<TariffRepository> {
        return this.#repoOverride ?? defaultTariffRepository();
    }

    async #liveRepo(): Promise<LiveTariffRepository> {
        return this.#liveRepoOverride ?? (await defaultLiveTariffRepository());
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return TARIFF_DESCRIBE;
    }

    @Component.Expose('List')
    @Component.CrudPermission('reports', 'read')
    async list(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffList(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('Get')
    @Component.CrudPermission('reports', 'read', NOT_A_REPORT_ID)
    async get(params: unknown, sender: CommandSender) {
        await requireTenantWideComponentPermission(sender, 'reports', 'read');
        return TariffHandlers.handleTariffGet(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('BillingPeriods')
    @Component.CrudPermission('reports', 'read')
    async billingPeriods(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffBillingPeriods(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('BillingPeriodAt')
    @Component.CrudPermission('reports', 'read')
    async billingPeriodAt(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffBillingPeriodAt(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('ListAssignments')
    @Component.CrudPermission('reports', 'read')
    async listAssignments(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffListAssignments(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('ResolveAssignments')
    @Component.CrudPermission('reports', 'read')
    async resolveAssignments(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffResolveAssignments(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('ResolvePricing')
    @Component.CrudPermission('reports', 'read')
    async resolvePricing(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffResolvePricing(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('Add')
    @Component.CrudPermission('reports', 'create', NOT_A_REPORT_ID)
    async add(params: unknown, sender: CommandSender) {
        if (namesExistingTariff(params)) {
            await requireTenantWideComponentPermission(
                sender,
                'reports',
                'update'
            );
        }
        return TariffHandlers.handleTariffAdd(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('Update')
    @Component.CrudPermission('reports', 'update', NOT_A_REPORT_ID)
    async update(params: unknown, sender: CommandSender) {
        await requireTenantWideComponentPermission(sender, 'reports', 'update');
        return TariffHandlers.handleTariffUpdate(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('reports', 'delete', NOT_A_REPORT_ID)
    async delete(params: unknown, sender: CommandSender) {
        await requireTenantWideComponentPermission(sender, 'reports', 'delete');
        return TariffHandlers.handleTariffDelete(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('Assign')
    @Component.CrudPermission('reports', 'update')
    async assign(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffAssign(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('SetLiveSource')
    @Component.CrudPermission('reports', 'update')
    async setLiveSource(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffSetLiveSource(
            params,
            sender,
            await this.#repo(),
            await this.#liveRepo()
        );
    }

    @Component.Expose('WriteComponents')
    @Component.CrudPermission('reports', 'update')
    async writeComponents(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffWriteComponents(
            params,
            sender,
            await this.#repo()
        );
    }
}
