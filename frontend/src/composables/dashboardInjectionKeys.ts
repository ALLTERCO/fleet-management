/**
 * Injection keys shared by the live dashboard renderer (pages/dash/[id].vue)
 * and any consumer that needs to render the same entries — including the
 * add-widget catalog previews (components/dashboard/CardPreview.vue).
 *
 * The live dashboard already maintains an entity cache (with bthome-type
 * metadata) and resolves the actions list from a registry; rather than
 * forcing every preview consumer to re-fetch those, we expose them through
 * provide/inject. Consumers without a provider fall back to the entity
 * store directly, which is good enough for catalog tiles.
 */

import type {InjectionKey, Ref} from 'vue';
import type {CachedEntity} from '@/composables/useDashboardEntryRenderer';
import type {action_t} from '@/types';

/** Map of entityId → cached entity record kept by the live dashboard. */
export const ENTITY_CACHE_KEY: InjectionKey<Ref<Map<string, CachedEntity>>> =
    Symbol('dashboard:entity-cache');

/** Reactive list of actions available to the dashboard. */
export const ACTIONS_LIST_KEY: InjectionKey<Ref<action_t[]>> = Symbol(
    'dashboard:actions-list'
);
