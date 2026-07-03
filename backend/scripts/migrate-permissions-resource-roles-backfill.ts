/**
 * Backfill: convert legacy ScopedPermission.selected: T[] → v2 {id, role}[]
 * for every Zitadel user. Idempotent — skips users already on v2.
 *
 * Usage:
 *   npx tsx scripts/migrate-permissions-resource-roles-backfill.ts [--apply]
 * Default is --dry-run.
 */

import type {
    ComponentName,
    FleetPermissionConfig
} from '../src/model/permissions';
import {
    deriveRoleFromCrud,
    isResourceAssignmentArray
} from '../src/model/resourceRoles';
import {parsePermissionConfig} from '../src/model/roleTemplates';
import {zitadelService} from '../src/modules/zitadel';

interface ListedUser {
    userId: string;
    userName?: string;
}

async function listAllUsers(): Promise<ListedUser[]> {
    // ZitadelService exposes a paginated listing helper used by the user-mgmt UI.
    const svc = zitadelService as unknown as {
        listUsers: (
            limit: number,
            offset: number
        ) => Promise<{users: ListedUser[]; total: number}>;
    };
    const out: ListedUser[] = [];
    let offset = 0;
    while (true) {
        const page = await svc.listUsers(200, offset);
        for (const u of page.users) out.push(u);
        if (page.users.length < 200) break;
        offset += 200;
    }
    return out;
}

function rewriteToV2(config: FleetPermissionConfig): {
    changed: boolean;
    next: FleetPermissionConfig;
} {
    let changed = false;
    const next: FleetPermissionConfig = JSON.parse(JSON.stringify(config));
    for (const [name, perms] of Object.entries(next.components)) {
        if (!perms || !('scope' in perms)) continue;
        if (perms.scope !== 'SELECTED') continue;
        if (!perms.selected || perms.selected.length === 0) continue;
        if (isResourceAssignmentArray(perms.selected)) continue;

        const role = deriveRoleFromCrud(name as ComponentName, perms);
        const ids = perms.selected as Array<string | number>;
        (perms as {selected: unknown}).selected = ids.map((id) => ({
            id,
            role
        }));
        changed = true;
    }
    return {changed, next};
}

async function main(): Promise<void> {
    const apply = process.argv.includes('--apply');
    const users = await listAllUsers();
    let scanned = 0;
    let upgraded = 0;
    let skipped = 0;
    let failed = 0;

    for (const u of users) {
        scanned++;
        try {
            const raw = await (
                zitadelService as unknown as {
                    getFmPermissions: (id: string) => Promise<unknown>;
                }
            ).getFmPermissions(u.userId);
            if (!raw) {
                skipped++;
                continue;
            }
            const expanded = parsePermissionConfig(raw);
            if (!expanded) {
                skipped++;
                continue;
            }
            const {changed, next} = rewriteToV2(expanded);
            if (!changed) {
                skipped++;
                continue;
            }
            if (apply) {
                await zitadelService.setFmPermissions(u.userId, next);
                console.log(`upgraded ${u.userId} (${u.userName ?? '?'})`);
            } else {
                console.log(
                    `[dry-run] would upgrade ${u.userId} (${u.userName ?? '?'})`
                );
            }
            upgraded++;
        } catch (err) {
            failed++;
            console.error(
                `failed ${u.userId}:`,
                err instanceof Error ? err.message : err
            );
        }
    }

    const tag = apply ? '' : ' (dry-run)';
    console.log(
        `done${tag} — scanned=${scanned} upgraded=${upgraded} skipped=${skipped} failed=${failed}`
    );
    if (failed > 0) process.exit(1);
}

main().catch((err) => {
    console.error('fatal:', err);
    process.exit(2);
});
