import * as postgres from '../PostgresProvider';

export interface LogicalChannelEnergyTotal {
    device: number;
    channel: number | null;
    tag: string;
    totalWh: number;
}

export interface LogicalChannelEnergyBucket {
    bucket: string;
    device: number;
    channel: number;
    tag: string;
    energy_wh: number;
}

interface LogicalEnergyDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<T[]>;
}

/** Report-grade channel totals for physical or custom logical device ids; a
 *  custom device in the set claims the source channels it represents. */
export async function queryLogicalChannelEnergyTotals(
    input: {
        internalIds: readonly number[];
        from: Date;
        to: Date;
        tags: readonly string[];
    },
    deps: LogicalEnergyDeps = postgres
): Promise<LogicalChannelEnergyTotal[]> {
    if (input.internalIds.length === 0 || input.tags.length === 0) return [];
    const rows = await deps.queryRows<{
        device: number;
        channel: number | null;
        tag: string;
        total_wh: number | string | null;
    }>(
        `SELECT
            energy.device,
            energy.channel,
            energy.tag,
            SUM(energy.sum_val)::double precision AS total_wh
           FROM device_em.fn_logical_energy_15min_rows(
                    $1::integer[], $2, $3, $4::varchar(30)[]) energy
          GROUP BY energy.device, energy.channel, energy.tag
          ORDER BY energy.device, energy.channel NULLS FIRST, energy.tag`,
        [[...input.internalIds], input.from, input.to, [...input.tags]]
    );
    return rows.map((row) => ({
        device: row.device,
        channel: row.channel,
        tag: row.tag,
        totalWh: Number(row.total_wh ?? 0)
    }));
}

/** One bounded read at the stored 15-minute grain for effective-dated meaning. */
export async function queryLogicalChannelEnergyByBucket(
    input: {
        internalIds: readonly number[];
        from: Date;
        to: Date;
        tags: readonly string[];
    },
    deps: LogicalEnergyDeps = postgres
): Promise<LogicalChannelEnergyBucket[]> {
    if (input.internalIds.length === 0 || input.tags.length === 0) return [];
    const rows = await deps.queryRows<{
        bucket: Date | string;
        device: number;
        channel: number | null;
        tag: string;
        energy_wh: number | string | null;
    }>(
        `SELECT energy.bucket, energy.device, energy.channel, energy.tag,
                SUM(energy.sum_val)::double precision AS energy_wh
           FROM device_em.fn_logical_energy_15min_rows(
                    $1::integer[], $2, $3, $4::varchar(30)[]) energy
          GROUP BY energy.bucket, energy.device, energy.channel, energy.tag
          ORDER BY energy.bucket, energy.device,
                   energy.channel NULLS FIRST, energy.tag`,
        [[...input.internalIds], input.from, input.to, [...input.tags]]
    );
    return rows.map((row) => ({
        bucket: new Date(row.bucket).toISOString(),
        device: row.device,
        channel: row.channel ?? 0,
        tag: row.tag,
        energy_wh: Number(row.energy_wh ?? 0)
    }));
}
