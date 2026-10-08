export const ENERGY_REPORT_METRIC_OPTIONS = [
    {key: 'consumption', label: 'Consumption', selectedByDefault: true},
    {key: 'returned_energy', label: 'Returned', selectedByDefault: false},
    {key: 'voltage', label: 'Voltage', selectedByDefault: false},
    {key: 'current', label: 'Current', selectedByDefault: false},
    {key: 'power', label: 'Power', selectedByDefault: false}
] as const;

export type EnergyReportMetricKey =
    (typeof ENERGY_REPORT_METRIC_OPTIONS)[number]['key'];

export function initialEnergyReportMetrics(): Record<
    EnergyReportMetricKey,
    boolean
> {
    return Object.fromEntries(
        ENERGY_REPORT_METRIC_OPTIONS.map(({key, selectedByDefault}) => [
            key,
            selectedByDefault
        ])
    ) as Record<EnergyReportMetricKey, boolean>;
}
