export interface FilterOption {
    key: string;
    label: string;
    count?: number;
}

export interface FilterSection {
    key: string;
    label: string;
    icon: string;
    searchable?: boolean;
    singleSelect?: boolean;
    options: FilterOption[];
}

export interface FilterState {
    [sectionKey: string]: string[];
}

export interface DeviceFilterState {
    groupIds: number[];
    models: string[];
    statuses: string[];
    search: string;
}

export interface FilterGroupOption {
    id: number;
    name: string;
    deviceCount: number;
}

export interface FilterModelOption {
    model: string;
    label: string;
    count: number;
}
