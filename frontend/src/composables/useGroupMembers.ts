import {type ComputedRef, computed} from 'vue';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import type {entity_t} from '@/types';

/** A `Group` stores component keys (`<type>:<cid>`), not entity ids, so members
 *  are matched on type + component id — the entity id suffix is composer-specific. */
export interface GroupMember {
    /** Raw device-side component key, exactly as the device reported it. */
    key: string;
    /** Lowercased component type, or '' when the key is malformed. */
    type: string;
    /** Component instance id, or NaN when the key is malformed. */
    componentId: number;
    /** Backing Fleet Manager entity, or null when the key resolves to nothing. */
    entity: entity_t | null;
}

const MEMBER_KEY_PATTERN = /^([A-Za-z0-9_]+):(\d+)$/;

export function parseMemberKey(
    key: string
): {type: string; componentId: number} | null {
    const match = MEMBER_KEY_PATTERN.exec(key);
    if (!match) return null;
    return {type: match[1].toLowerCase(), componentId: Number(match[2])};
}

/** Resolve member keys against the device's entities. Unknown keys resolve to
 *  `entity: null` rather than being dropped, so a stale key stays visible. */
export function resolveGroupMembers(
    memberKeys: readonly string[],
    deviceEntities: readonly entity_t[]
): GroupMember[] {
    return memberKeys.map((key) => {
        const parsed = parseMemberKey(key);
        if (!parsed) {
            return {key, type: '', componentId: Number.NaN, entity: null};
        }
        const entity = deviceEntities.find(
            (candidate) =>
                candidate.type === parsed.type &&
                candidate.properties?.id === parsed.componentId
        );
        return {key, ...parsed, entity: entity ?? null};
    });
}

/** Live view of a group's members, tracking both the device and entity stores. */
export function useGroupMembers(
    source: () => string,
    memberKeys: () => readonly string[]
): ComputedRef<GroupMember[]> {
    const deviceStore = useDevicesStore();
    const entityStore = useEntityStore();

    return computed(() => {
        const device = deviceStore.devices[source()];
        const entities: entity_t[] = [];
        for (const id of device?.entities ?? []) {
            const entity = entityStore.entities[id];
            if (entity) entities.push(entity);
        }
        return resolveGroupMembers(memberKeys(), entities);
    });
}
