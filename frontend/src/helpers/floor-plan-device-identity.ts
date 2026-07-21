export interface FloorPlanDeviceIdentity {
    id: string;
    placementId?: string;
}

export function floorPlanPlacementId(device: FloorPlanDeviceIdentity): string {
    return device.placementId ?? device.id;
}
