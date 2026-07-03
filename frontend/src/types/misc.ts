export type notification_type_t = 'success' | 'info' | 'warning' | 'error';

export interface tag_t {
    [key: string]: {
        label: string;
        addon?: {label: string; color: string};
        click_cb?: () => void;
    };
}

export interface dashboard_t {
    name: string;
    id: number | string;
    items: any[];
}

export interface dashboard_entry_t {
    type: 'entity' | 'iframe' | 'group' | 'device';
    col_width: number;
    col_height: number;
    data: any;
}

export interface action_t {
    name: string;
    id: string;
    type: string;
    actions: any[];
    icon?: string;
}
