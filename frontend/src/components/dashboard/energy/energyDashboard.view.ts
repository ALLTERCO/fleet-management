import {energyDashboardSample} from './energyDashboard.sample';
import type {EnergyDashboardData} from './energyDashboard.types';

// Preview fallback only. Production data must never be filled with sample values.
export function resolveEnergyDashboardView(data: EnergyDashboardData | null | undefined): EnergyDashboardData {
    return data ?? energyDashboardSample();
}
