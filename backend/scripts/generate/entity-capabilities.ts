/**
 * Entity capability inventory — one row per entity type, showing which
 * actions the backend knows how to build for it and which device RPC
 * each one dispatches.
 *
 * The runtime filter in `Entity.GetCapabilities` narrows this list
 * further by `Shelly.ListMethods` — so this document is the "potential"
 * capability set. Use it to see what's wired in code; use
 * `Entity.GetCapabilities` to see what a specific device actually
 * advertises.
 */

import {
    actionsForEntityType,
    shellyMethodForAction
} from '../../src/model/entity/actionAdapter.js';
import {
    ENTITY_TYPE_TO_SHELLY_COMPONENT,
    listRegisteredEntityTypes
} from '../../src/model/entity/capabilities.js';
import {mdCodeInline, provenanceHeader} from './_shared.js';

export interface EntityCapabilityRow {
    type: string;
    shellyComponent: string | null;
    actions: {action: string; rpc: string}[];
}

export interface EntityCapabilityInventory {
    totals: {
        entityTypes: number;
        actionCount: number;
    };
    entities: EntityCapabilityRow[];
}

export function generate(): EntityCapabilityInventory {
    const types = listRegisteredEntityTypes();
    const entities: EntityCapabilityRow[] = types.map((type) => {
        const actions = actionsForEntityType(type).map((action) => ({
            action,
            rpc: shellyMethodForAction(type, action) ?? '??'
        }));
        return {
            type,
            shellyComponent: ENTITY_TYPE_TO_SHELLY_COMPONENT[type] ?? null,
            actions
        };
    });

    const actionCount = entities.reduce((n, e) => n + e.actions.length, 0);
    return {
        totals: {entityTypes: entities.length, actionCount},
        entities
    };
}

export function renderMarkdown(inv: EntityCapabilityInventory): string {
    const header = provenanceHeader('Entity Capability Inventory', [
        'backend/src/model/entity/capabilities.ts',
        'backend/src/model/entity/actionAdapter.ts'
    ]);

    const lines: string[] = [
        `Total entity types: **${inv.totals.entityTypes}**`,
        `Total buildable actions: **${inv.totals.actionCount}**`,
        '',
        '| Entity type | Shelly component | Actions (RPC) |',
        '|---|---|---|'
    ];

    for (const e of inv.entities) {
        const comp = e.shellyComponent ? mdCodeInline(e.shellyComponent) : '—';
        const actions = e.actions.length
            ? e.actions
                  .map(
                      (a) =>
                          `${mdCodeInline(a.action)} → ${mdCodeInline(a.rpc)}`
                  )
                  .join('<br>')
            : '—';
        lines.push(`| ${mdCodeInline(e.type)} | ${comp} | ${actions} |`);
    }

    return header + lines.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const inv = generate();
    import('./_shared.js').then((mod) => {
        mod.writeOutputs('entity-capabilities', inv, renderMarkdown(inv));
    });
}
