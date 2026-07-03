import * as ws from '@/tools/websocket';

export type KindAppliesTo = 'device' | 'group' | 'both';

export interface KindEntry {
    id: string;
    name: string;
    category: string;
    icon: string | null;
    appliesTo: KindAppliesTo;
    source: 'vendor' | 'custom';
}

export async function listKinds(
    appliesTo: KindAppliesTo = 'both'
): Promise<KindEntry[]> {
    const res = await ws.sendRPC<{kinds: KindEntry[]}>(
        'FLEET_MANAGER',
        'kind.List',
        {appliesTo}
    );
    return res.kinds;
}
