export interface OnlineDeviceLike {
    online?: boolean;
}

export function countOnlineDevices(
    devices: Readonly<Record<string, OnlineDeviceLike>>
): number {
    return Object.values(devices).filter((device) => device.online === true)
        .length;
}

export function deviceOnlinePercent(
    deviceCount: number,
    onlineCount: number
): number {
    if (deviceCount <= 0) return 0;
    return Math.round((onlineCount / deviceCount) * 10_000) / 100;
}
