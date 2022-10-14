export default interface ShellyDevice {
    shellyID: string,
    lastStatus: any,
    lastStatusTs: 1664952086352,
    deviceInfo: any,
    source: "ws" | "ble",
    channels: number,
    fields: Record<string, any>,
    selected: boolean
}