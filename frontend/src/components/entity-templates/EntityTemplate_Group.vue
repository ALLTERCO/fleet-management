<template>
    <div class="et-group">
        <div v-if="!rows.length" class="et-group__empty">
            <i class="fas fa-layer-group et-group__empty-icon" />
            <span>No members in this group</span>
        </div>

        <div
            v-for="row in rows"
            :key="row.member.key"
            class="et-group__row"
        >
            <div class="et-group__label">
                <i :class="row.icon" class="et-group__icon" />
                <span class="et-group__name">{{ row.label }}</span>
            </div>

            <!-- Each member uses its own registry template. -->
            <component
                :is="row.template"
                v-if="row.template"
                :status="row.status"
                :settings="row.settings"
                :can-execute="canExecute"
                v-bind="row.extraProps"
                v-on="row.listeners"
            />
            <div v-else class="et-group__readonly">{{ row.readonlyText }}</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {useCardRpc} from '@/composables/useCardRpc';
import {type GroupMember, useGroupMembers} from '@/composables/useGroupMembers';
import {
    getEntityActions,
    getEntityExtraProps,
    getEntityIcon,
    getEntityTemplate
} from '@/config/entity-registry';
import {useDevicesStore} from '@/stores/devices';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    /** shellyID of the device this group lives on. */
    source: string;
    members?: string[];
}>();

const deviceStore = useDevicesStore();
const rpc = useCardRpc();

// `properties.members` is a compose-time snapshot; it goes stale after Group.Set.
const memberKeys = computed<string[]>(() => {
    const live = props.status?.value;
    if (Array.isArray(live)) return live.filter((k) => typeof k === 'string');
    return props.members ?? [];
});

const resolvedMembers = useGroupMembers(
    () => props.source,
    () => memberKeys.value
);

interface MemberRow {
    member: GroupMember;
    label: string;
    icon: string;
    template: ReturnType<typeof getEntityTemplate>;
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    extraProps: Record<string, any>;
    listeners: Record<string, (...args: any[]) => void>;
    readonlyText: string;
}

const rows = computed<MemberRow[]>(() =>
    resolvedMembers.value.map((member) => buildRow(member))
);

function buildRow(member: GroupMember): MemberRow {
    const entity = member.entity;
    const device = deviceStore.devices[props.source];
    const status = entity
        ? deviceStore.statusOf(props.source, member.key)
        : undefined;

    // A nested group would recurse into this template, so it stays read-only.
    const renderable = !!entity && entity.type !== 'group';
    const profile = entity?.properties?.deviceProfile;
    const template = renderable
        ? getEntityTemplate(entity.type, profile)
        : undefined;

    return {
        member,
        label: entity?.name || member.key,
        icon: entity
            ? getEntityIcon(entity.type, entity.properties)
            : 'fas fa-circle-question',
        template,
        status,
        settings: device?.settings?.[member.key],
        extraProps: renderable
            ? (getEntityExtraProps(entity.type, profile)?.(entity) ?? {})
            : {},
        listeners: renderable ? buildListeners(member, status) : {},
        readonlyText: readonlyTextFor(member)
    };
}

/** Wire member events to the member's OWN entity id, so it dispatches the same
 *  RPC it would as a standalone widget. */
function buildListeners(
    member: GroupMember,
    status: Record<string, any> | undefined
): Record<string, (...args: any[]) => void> {
    const entity = member.entity;
    if (!entity) return {};
    const actions = getEntityActions(
        entity.type,
        entity.properties?.deviceProfile
    );
    if (!actions) return {};

    const listeners: Record<string, (...args: any[]) => void> = {};
    for (const [eventName, handler] of Object.entries(actions)) {
        listeners[eventName] = (...args: any[]) => {
            const call = handler(entity.properties.id, status, ...args);
            void rpc.invokeAction(
                entity.id,
                call.action,
                call.params,
                entity.name
            );
        };
    }
    return listeners;
}

function readonlyTextFor(member: GroupMember): string {
    if (!member.entity) return 'Unavailable';
    if (member.entity.type === 'group') return 'Nested group';
    return 'No control';
}
</script>

<style scoped>
.et-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.et-group__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-group__label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    color: var(--color-text-secondary);
}
.et-group__icon {
    flex-shrink: 0;
    opacity: 0.7;
}
.et-group__name {
    font-weight: var(--font-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.et-group__readonly {
    color: var(--color-text-tertiary);
}
.et-group__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    color: var(--color-text-tertiary);
}
.et-group__empty-icon {
    opacity: 0.7;
}
</style>
