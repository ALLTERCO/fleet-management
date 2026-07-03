/** Live deploy verification — RPC sweep + template-scope matrix.
 *
 * Reads `FM_TEST_URL` and `FM_TEST_PAT` from env. Skips quietly if either
 * is missing so the CI suite degrades gracefully on non-deployed runs.
 *
 * Run: tsx scripts/test/fleet-deploy-verify.ts
 */

const URL = process.env.FM_TEST_URL;
const PAT = process.env.FM_TEST_PAT;

if (!URL || !PAT) {
    console.log('FM_TEST_URL or FM_TEST_PAT not set — skipping live verify.');
    process.exit(0);
}

let nextId = 1;
const fails: string[] = [];

async function rpc<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
): Promise<{ok: boolean; result?: T; error?: {code: number; message: string}}> {
    const body = {jsonrpc: '2.0', id: nextId++, method, params};
    const res = await fetch(`${URL}/rpc`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${PAT}`
        },
        body: JSON.stringify(body)
    });
    const json = (await res.json()) as {
        result?: T;
        error?: {code: number; message: string};
    };
    if (json.error) return {ok: false, error: json.error};
    return {ok: true, result: json.result};
}

function expect(label: string, cond: boolean, detail = '') {
    if (!cond) fails.push(`${label}: ${detail}`);
    console.log(`${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
    // 1. Group.GetMetrics / Group.GetCapabilities must be gone (MethodNotFound).
    {
        const r = await rpc('Group.GetMetrics', {groupId: 1});
        expect(
            'Group.GetMetrics returns MethodNotFound',
            !r.ok && r.error?.code === -32601,
            JSON.stringify(r.error ?? r.result)
        );
    }
    {
        const r = await rpc('Group.GetCapabilities', {groupId: 1});
        expect(
            'Group.GetCapabilities returns MethodNotFound',
            !r.ok && r.error?.code === -32601,
            JSON.stringify(r.error ?? r.result)
        );
    }

    // 2. fleet.GetMetrics / fleet.GetCapabilities exist and return valid shape.
    {
        const r = await rpc<Record<string, unknown>>('fleet.GetMetrics', {});
        expect(
            'fleet.GetMetrics fleet call returns successfully',
            r.ok,
            JSON.stringify(r.error)
        );
        if (r.ok && r.result) {
            const o = r.result as Record<string, unknown>;
            expect(
                'fleet.GetMetrics result has scopeKind',
                'scopeKind' in o,
                JSON.stringify(Object.keys(o))
            );
            expect(
                'fleet.GetMetrics result has devices array',
                Array.isArray(o.devices),
                ''
            );
        }
    }
    {
        const r = await rpc<Record<string, unknown>>(
            'fleet.GetCapabilities',
            {}
        );
        expect(
            'fleet.GetCapabilities fleet call returns successfully',
            r.ok,
            JSON.stringify(r.error)
        );
        if (r.ok && r.result) {
            const o = r.result as Record<string, unknown>;
            expect(
                'fleet.GetCapabilities result has capabilities array',
                Array.isArray(o.capabilities),
                ''
            );
        }
    }

    // 3. Energy.Query accepts a fleet-scope time-series request (the method
    // that subsumed the removed Energy.Summary).
    {
        const from = new Date(Date.now() - 86_400_000).toISOString();
        const to = new Date().toISOString();
        const r = await rpc<Record<string, unknown>>('Energy.Query', {
            from,
            to,
            tags: ['total_act_energy'],
            bucket: '1 day'
        });
        expect(
            'Energy.Query fleet returns successfully',
            r.ok,
            JSON.stringify(r.error)
        );
        if (r.ok && r.result) {
            const items = (r.result as {items?: unknown[]}).items;
            expect(
                'Energy.Query returns items array',
                Array.isArray(items),
                ''
            );
        }
    }

    // 4. Template materialisation matrix — 7 templates × 3 scope axes.
    const templates = [
        'overview_default',
        'energy_default',
        'environment_default',
        'control_default',
        'safety_default',
        'classic_blank',
        'analytics_blank'
    ];
    const axes: Array<{label: string; scope: Record<string, number>}> = [
        {label: 'group', scope: {groupId: 1}},
        {label: 'location', scope: {locationId: 1}},
        {label: 'tag', scope: {tagId: 1}}
    ];

    for (const tpl of templates) {
        for (const axis of axes) {
            const r = await rpc<Record<string, unknown>>('Dashboard.Create', {
                name: `verify-${tpl}-${axis.label}-${Date.now()}`,
                dashboardType: tpl.includes('classic')
                    ? 'classic'
                    : tpl.includes('analytics')
                      ? 'analytics'
                      : tpl.replace('_default', ''),
                scope: axis.scope,
                template: tpl
            });
            const okOrSafeFail =
                r.ok ||
                r.error?.code === 1500 ||
                r.error?.code === 1501 ||
                r.error?.code === 1504 ||
                r.error?.code === 1505;
            expect(
                `Dashboard.Create template=${tpl} axis=${axis.label}`,
                okOrSafeFail,
                JSON.stringify(r.error)
            );
            if (r.ok && r.result) {
                const o = r.result as Record<string, unknown>;
                const id = o.id as number | undefined;
                if (typeof id === 'number') {
                    await rpc('Dashboard.Delete', {id});
                }
            }
        }
    }

    if (fails.length) {
        console.error(`\n${fails.length} failures:`);
        for (const f of fails) console.error(`  - ${f}`);
        process.exit(1);
    }
    console.log('\nAll deploy checks passed.');
}

main().catch((err) => {
    console.error('verify script crashed:', err);
    process.exit(2);
});
