import {
    type CarbonRepository,
    defaultCarbonRepository
} from '../../modules/repositories/CarbonRepository.js';
import type {DescribeOutput} from '../../rpc/describe.js';
import {validateOrThrow} from '../../rpc/validateOrThrow.js';
import {
    CARBON_CALCULATE_BREAKDOWN_PARAMS_SCHEMA,
    CARBON_CALCULATE_PARAMS_SCHEMA,
    CARBON_DESCRIBE,
    CARBON_LIST_PARAMS_SCHEMA,
    CARBON_PRICE_SPEC_SCHEMA,
    type CarbonCalculateBreakdownParams,
    type CarbonCalculateParams,
    type CarbonListParams,
    type CarbonPriceSpec,
    EMISSION_FACTOR_SPEC_SCHEMA,
    type EmissionFactorSpec
} from '../../types/api/carbon.js';
import type CommandSender from '../CommandSender.js';
import {handleCarbonCalculateBreakdown} from '../carbon/carbonBreakdownHandler.js';
import * as CarbonHandlers from '../carbon/carbonHandlers.js';
import Component from './Component.js';

// A spec's own id is a carbon row id, not a report; adding checks the grant alone.
const NOT_A_REPORT_ID = (): undefined => undefined;

export default class CarbonComponent extends Component {
    readonly #repoOverride?: CarbonRepository;

    constructor(repoOverride?: CarbonRepository) {
        super('carbon', {set_config_methods: false, auto_apply_config: false});
        this.#repoOverride = repoOverride;
    }

    async #repo(): Promise<CarbonRepository> {
        return this.#repoOverride ?? defaultCarbonRepository();
    }

    protected override getDefaultConfig(): Record<string, never> {
        return {};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return CARBON_DESCRIBE;
    }

    @Component.Expose('ListEmissionFactors')
    @Component.CrudPermission('reports', 'read')
    async listEmissionFactors(params: unknown, sender: CommandSender) {
        const validated = validateOrThrow<CarbonListParams>(
            params ?? {},
            CARBON_LIST_PARAMS_SCHEMA
        );
        return CarbonHandlers.handleListEmissionFactors(
            validated,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('AddEmissionFactor')
    @Component.CrudPermission('reports', 'create', NOT_A_REPORT_ID)
    async addEmissionFactor(params: unknown, sender: CommandSender) {
        const validated = validateOrThrow<EmissionFactorSpec>(
            params,
            EMISSION_FACTOR_SPEC_SCHEMA
        );
        return CarbonHandlers.handleAddEmissionFactor(
            validated,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('ListPrices')
    @Component.CrudPermission('reports', 'read')
    async listPrices(params: unknown, sender: CommandSender) {
        const validated = validateOrThrow<CarbonListParams>(
            params ?? {},
            CARBON_LIST_PARAMS_SCHEMA
        );
        return CarbonHandlers.handleListPrices(
            validated,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('AddPrice')
    @Component.CrudPermission('reports', 'create', NOT_A_REPORT_ID)
    async addPrice(params: unknown, sender: CommandSender) {
        const validated = validateOrThrow<CarbonPriceSpec>(
            params,
            CARBON_PRICE_SPEC_SCHEMA
        );
        return CarbonHandlers.handleAddPrice(
            validated,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('Calculate')
    @Component.CrudPermission('reports', 'read')
    async calculate(params: unknown, sender: CommandSender) {
        const validated = validateOrThrow<CarbonCalculateParams>(
            params,
            CARBON_CALCULATE_PARAMS_SCHEMA
        );
        return CarbonHandlers.handleCalculate(
            validated,
            sender,
            await this.#repo()
        );
    }

    @Component.Expose('CalculateBreakdown')
    @Component.CrudPermission('reports', 'read')
    @Component.RateLimit('expensive')
    async calculateBreakdown(params: unknown, sender: CommandSender) {
        const validated = validateOrThrow<CarbonCalculateBreakdownParams>(
            params,
            CARBON_CALCULATE_BREAKDOWN_PARAMS_SCHEMA
        );
        return handleCarbonCalculateBreakdown(
            validated,
            sender,
            await this.#repo()
        );
    }
}
