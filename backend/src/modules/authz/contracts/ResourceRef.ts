export type ResourceId = string | number;

export interface ResourceRef {
    type: string;
    id?: ResourceId;
    orgId?: string;
    ownerId?: string;
    dashboardId?: ResourceId;
    locationId?: number;
    locationIds?: number[];
    deviceGroupIds?: number[];
    tags?: string[];
    pluginKey?: string;
}
