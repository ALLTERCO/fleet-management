<template>
    <div class="ov-contact">
        <div class="ov-contact__head">
            <span class="ov-contact__name">{{ contact.name }}</span>
            <span v-if="contact.role" class="ov-contact__role">{{ contact.role }}</span>
        </div>
        <ul class="ov-contact__lines">
            <li v-if="contact.email" class="ov-contact__line">
                <i class="fas fa-envelope" aria-hidden="true" />
                <a :href="`mailto:${contact.email}`">{{ contact.email }}</a>
            </li>
            <li v-if="contact.phone" class="ov-contact__line">
                <i class="fas fa-phone" aria-hidden="true" />
                <a :href="`tel:${contact.phone}`">{{ contact.phone }}</a>
            </li>
            <li v-if="contact.afterHours" class="ov-contact__line ov-contact__line--mute">
                <i class="fas fa-moon" aria-hidden="true" />
                After hours OK
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
export interface OverviewContact {
    readonly name: string;
    readonly role?: string;
    readonly email?: string;
    readonly phone?: string;
    readonly afterHours?: boolean;
}

defineProps<{contact: OverviewContact}>();
</script>

<style scoped>
.ov-contact {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    min-width: 0;
}

.ov-contact__head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
}

.ov-contact__name {
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
}

.ov-contact__role {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.ov-contact__lines {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.ov-contact__line {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
}

.ov-contact__line i {
    color: var(--color-text-quaternary);
    width: 14px;
    text-align: center;
    flex-shrink: 0;
}

.ov-contact__line a {
    color: var(--color-text-secondary);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.ov-contact__line a:hover {
    color: var(--color-primary);
    text-decoration: underline;
}

.ov-contact__line--mute {
    color: var(--color-text-tertiary);
}
</style>
