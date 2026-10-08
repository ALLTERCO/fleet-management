interface DeliveryAggregateSummary {
    total: number;
    critical: number;
    warning: number;
    info: number;
}

export function summaryLine(
    aggregate: DeliveryAggregateSummary | null | undefined
): string {
    if (!aggregate) return '';
    const parts: string[] = [`${aggregate.total} alerts`];
    if (aggregate.critical > 0) parts.push(`${aggregate.critical} critical`);
    if (aggregate.warning > 0) parts.push(`${aggregate.warning} warning`);
    if (aggregate.info > 0) parts.push(`${aggregate.info} info`);
    return parts.join(', ');
}
