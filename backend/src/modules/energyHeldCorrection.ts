// The retention job runs inside the database, so the correction window from
// tuning reaches it through device_em.stats_retention.

export type HeldCorrectionDbCaller = (
    method: string,
    params: Record<string, unknown>
) => Promise<unknown>;

export async function applyHeldCorrectionWindow(
    callDb: HeldCorrectionDbCaller,
    days: number
): Promise<void> {
    await callDb('device_em.fn_configure_held_correction', {
        p_window: `${days} days`
    });
}
