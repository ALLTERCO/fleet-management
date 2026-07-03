/**
 * Tariff namespace — org-level electricity tariff library.
 *
 * Registers `Tariff.List/Get/Add/Update/Delete/Assign`. Heavy lifting lives
 * in `model/tariff/tariffHandlers.ts` as pure functions — this component is
 * a thin adapter so handlers can be unit-tested without the Component graph.
 */

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
    @Component.CrudPermission('reports', 'read')
    async get(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffGet(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('Add')
    @Component.CrudPermission('reports', 'create')
    async add(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffAdd(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('Update')
    @Component.CrudPermission('reports', 'update')
    async update(params: unknown, sender: CommandSender) {
        return TariffHandlers.handleTariffUpdate(
            params,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('Delete')
    @Component.CrudPermission('reports', 'delete')
    async delete(params: unknown, sender: CommandSender) {
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
}
