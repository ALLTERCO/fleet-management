import type {TariffTaxSpec} from '../../types/api/tariff';
import type {TariffComponentCalculation} from './tariffComponents';
import type {TariffDemandChargeResult} from './tariffDemandCharges';

export interface BillChargeSummary {
    billingMonths: number;
    demand: number;
    demandResult: TariffDemandChargeResult | null;
    standing: number;
    taxes: readonly TariffTaxSpec[];
    fractionDigits: number;
    complete: boolean;
    components: TariffComponentCalculation;
    total: number | null;
}
