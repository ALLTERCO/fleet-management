// Pure boundary translation: legacy Dashboard.AddItem (type, item, sub_item)
// → typed FK params for v3 SQL fns. Kept side-effect-free so unit tests can
// pin the mapping without importing the DB-touching DashboardRegistry chain.

import * as log4js from 'log4js';
import type {DashboardItemKind} from '../types/api/dashboard';
import * as Observability from './Observability';

const logger = log4js.getLogger('dashboard-legacy-map');

// NOT an array index — DASHBOARD_ITEM_KINDS order may include new kinds whose
// position would shift the legacy mapping (this regressed once already).
export const TYPE_TO_KIND: Record<number, DashboardItemKind> = {
    1: 'device',
    2: 'entity',
    3: 'group',
    4: 'action',
    5: 'widget'
};

export interface TypedRefFields {
    p_device_id: number | null;
    p_entity_sub_id: string | null;
    p_group_id: number | null;
    p_location_id: number | null;
    p_tag_id: number | null;
    p_action_id: number | null;
    p_widget_kind: string | null;
    p_widget_config: Record<string, unknown> | null;
}

export function legacyToTyped(
    kind: DashboardItemKind,
    item: number,
    sub_item: string | null
): TypedRefFields {
    const empty: TypedRefFields = {
        p_device_id: null,
        p_entity_sub_id: null,
        p_group_id: null,
        p_location_id: null,
        p_tag_id: null,
        p_action_id: null,
        p_widget_kind: null,
        p_widget_config: null
    };
    switch (kind) {
        case 'device':
            return {...empty, p_device_id: item};
        case 'entity':
            return {...empty, p_device_id: item, p_entity_sub_id: sub_item};
        case 'group':
            return {...empty, p_group_id: item};
        case 'location':
            return {...empty, p_location_id: item};
        case 'tag':
            return {...empty, p_tag_id: item};
        case 'action':
            return {...empty, p_action_id: item};
        default: {
            // widget — sub_item is JSON {id, ...config}.
            if (sub_item) {
                try {
                    const cfg = JSON.parse(sub_item);
                    if (cfg && typeof cfg === 'object') {
                        return {
                            ...empty,
                            p_widget_kind:
                                typeof cfg.id === 'string' ? cfg.id : null,
                            p_widget_config: cfg
                        };
                    }
                } catch (err) {
                    // Poison sub_item — count + drop so ops sees recurring
                    // dashboard imports with malformed widget config.
                    Observability.incrementCounter(
                        'dashboard_legacy_widget_parse_errors'
                    );
                    logger.debug('legacy widget parse failed: %s', err);
                }
            }
            return empty;
        }
    }
}
