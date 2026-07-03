// The single grain at which a logical meter OWNS and QUERIES energy:
// (device, channel, tag). Channel energy is phase-summed and componentKey is
// only a display label, so neither phase nor componentKey distinguishes
// ownership — and device_em.fn_report_energy_15min_by_channel groups them away
// too. One home so the wizard picker, save-validation, and the energy query all
// agree on what "the same point" means; a finer key in any one of them lets the
// picker offer points the save or query cannot tell apart.

export function meterPointKey(
    deviceId: number,
    channel: number,
    tag: string
): string {
    return `${deviceId}|${channel}|${tag}`;
}
