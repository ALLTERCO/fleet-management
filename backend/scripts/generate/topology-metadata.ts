import ts from 'typescript';
import {inferTopologyFlowsFromText} from '../../src/modules/observability/topologyFlowDefinitions.js';
import {
    getBackendProgram,
    getBackendSourceFiles,
    mdCodeInline,
    mdEscape,
    provenanceHeader,
    relPath
} from './_shared.js';

export interface TopologyMetadataModule {
    id: string;
    label: string;
    role: string;
    zone: string;
    cluster: string;
    kind: string;
    owner: string;
    criticality: string;
    route: string;
    description: string;
    upstreams: string[];
    downstreams: string[];
    participatesIn: string[];
    dataClasses: string[];
    externalSystem: string;
    collapseByDefault: boolean;
    noisy: boolean;
    sourceFile: string;
    sourceLine: number;
    hasTopology: boolean;
}

export interface TopologyMetadataEdge {
    id: string;
    from: string;
    to: string;
    declaredBy: string;
}

export interface TopologyMetadataInventory {
    totals: {
        modules: number;
        withTopology: number;
        missingTopology: number;
        edges: number;
        flows: number;
        zones: number;
    };
    modules: TopologyMetadataModule[];
    edges: TopologyMetadataEdge[];
    flows: Array<{id: string; modules: string[]; edges: string[]}>;
    zones: Array<{id: string; modules: string[]}>;
    mermaid: string;
}

const KNOWN_TOPOLOGY_ZONES = [
    'ingress',
    'device_admission',
    'device_data_pipeline',
    'command_plane',
    'runtime',
    'storage',
    'auth_security',
    'observability',
    'ui_clients',
    'operations',
    'integrations',
    'external_systems',
    'unclassified'
] as const;

const ZONE_BY_CLUSTER: Record<string, string> = {
    ingest: 'ingress',
    pipeline: 'device_data_pipeline',
    storage: 'storage',
    clients: 'ui_clients',
    security: 'auth_security',
    services: 'runtime',
    meta: 'observability'
};

export function generate(): TopologyMetadataInventory {
    const modules = collectModules();
    const edges = collectEdges(modules);
    const flows = collectFlows(modules, edges);
    const zones = collectZones(modules);
    return {
        totals: {
            modules: modules.length,
            withTopology: modules.filter((module) => module.hasTopology).length,
            missingTopology: modules.filter((module) => !module.hasTopology)
                .length,
            edges: edges.length,
            flows: flows.length,
            zones: zones.length
        },
        modules,
        edges,
        flows,
        zones,
        mermaid: renderMermaid(modules, edges)
    };
}

export function renderMarkdown(inventory: TopologyMetadataInventory): string {
    return [
        provenanceHeader('Topology Metadata Inventory', [
            'backend/src/modules/**',
            'Observability.registerModule(...)'
        ]),
        renderTotals(inventory),
        renderZones(inventory),
        renderModules(inventory),
        renderEdges(inventory),
        renderFlows(inventory),
        '## Mermaid Export',
        '',
        '```mermaid',
        inventory.mermaid,
        '```',
        ''
    ].join('\n');
}

function collectModules(): TopologyMetadataModule[] {
    const program = getBackendProgram();
    const modules: TopologyMetadataModule[] = [];
    for (const source of getBackendSourceFiles(program)) {
        source.forEachChild(function visit(node) {
            const module = moduleFromNode(node, source);
            if (module) modules.push(module);
            node.forEachChild(visit);
        });
    }
    return modules.sort((a, b) => a.id.localeCompare(b.id));
}

function moduleFromNode(
    node: ts.Node,
    source: ts.SourceFile
): TopologyMetadataModule | null {
    if (!ts.isCallExpression(node) || !isRegisterModuleCall(node)) return null;
    const [idArg, regArg] = node.arguments;
    const id = stringValue(idArg);
    if (!id) return null;
    const topology = topologyObject(regArg);
    const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
    return {
        id,
        label: readString(topology, 'label') ?? id,
        role: readString(topology, 'role') ?? 'service',
        zone: readString(topology, 'zone') ?? '',
        cluster: readString(topology, 'cluster') ?? '',
        kind: readString(topology, 'kind') ?? '',
        owner: readString(topology, 'owner') ?? '',
        criticality: readString(topology, 'criticality') ?? '',
        route: readString(topology, 'route') ?? '',
        description: readString(topology, 'description') ?? '',
        upstreams: readStringArray(topology, 'upstreams'),
        downstreams: readStringArray(topology, 'downstreams'),
        participatesIn: inferTopologyFlowsFromText(
            moduleSearchText({
                id,
                label: readString(topology, 'label') ?? id,
                role: readString(topology, 'role') ?? 'service',
                zone: readString(topology, 'zone') ?? '',
                cluster: readString(topology, 'cluster') ?? '',
                route: readString(topology, 'route') ?? '',
                description: readString(topology, 'description') ?? ''
            }),
            readStringArray(topology, 'participatesIn')
        ),
        dataClasses: readStringArray(topology, 'dataClasses'),
        externalSystem: readString(topology, 'externalSystem') ?? '',
        collapseByDefault: readBoolean(topology, 'collapseByDefault') ?? false,
        noisy: readBoolean(topology, 'noisy') ?? false,
        sourceFile: relPath(source.fileName),
        sourceLine: pos.line + 1,
        hasTopology: topology !== null
    };
}

function moduleSearchText(module: {
    id: string;
    label: string;
    role: string;
    zone: string;
    cluster: string;
    route: string;
    description: string;
}): string {
    return [
        module.id,
        module.label,
        module.description,
        module.route,
        module.cluster,
        module.zone,
        module.role
    ].join(' ');
}

function isRegisterModuleCall(node: ts.CallExpression): boolean {
    const expr = node.expression;
    if (ts.isPropertyAccessExpression(expr)) {
        return expr.name.text === 'registerModule';
    }
    return ts.isIdentifier(expr) && expr.text === 'registerModule';
}

function topologyObject(
    arg: ts.Expression | undefined
): ts.ObjectLiteralExpression | null {
    if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
    const topology = propertyValue(arg, 'topology');
    return topology && ts.isObjectLiteralExpression(topology) ? topology : null;
}

function propertyValue(
    object: ts.ObjectLiteralExpression | null,
    key: string
): ts.Expression | null {
    if (!object) return null;
    for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = propertyName(property.name);
        if (name === key) return property.initializer;
    }
    return null;
}

function propertyName(name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    return null;
}

function readString(
    object: ts.ObjectLiteralExpression | null,
    key: string
): string | null {
    return stringValue(propertyValue(object, key));
}

function readBoolean(
    object: ts.ObjectLiteralExpression | null,
    key: string
): boolean | null {
    const value = propertyValue(object, key);
    if (!value) return null;
    if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
    return null;
}

function readStringArray(
    object: ts.ObjectLiteralExpression | null,
    key: string
): string[] {
    const value = propertyValue(object, key);
    if (!value || !ts.isArrayLiteralExpression(value)) return [];
    return value.elements
        .map((element) => stringValue(element))
        .filter((item): item is string => item !== null);
}

function stringValue(value: ts.Node | undefined | null): string | null {
    if (!value) return null;
    if (
        ts.isStringLiteral(value) ||
        ts.isNoSubstitutionTemplateLiteral(value)
    ) {
        return value.text;
    }
    return null;
}

function collectEdges(
    modules: readonly TopologyMetadataModule[]
): TopologyMetadataEdge[] {
    const byId = new Map<string, TopologyMetadataEdge>();
    for (const module of modules) {
        for (const to of module.downstreams) {
            upsertEdge(byId, module.id, to, module.id);
        }
        for (const from of module.upstreams) {
            upsertEdge(byId, from, module.id, module.id);
        }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function upsertEdge(
    map: Map<string, TopologyMetadataEdge>,
    from: string,
    to: string,
    declaredBy: string
): void {
    const id = `${from}->${to}`;
    if (map.has(id)) return;
    map.set(id, {id, from, to, declaredBy});
}

function collectFlows(
    modules: readonly TopologyMetadataModule[],
    edges: readonly TopologyMetadataEdge[]
): Array<{id: string; modules: string[]; edges: string[]}> {
    const flowIds = new Set(modules.flatMap((module) => module.participatesIn));
    return [...flowIds].sort().map((id) => {
        const flowModules = modules
            .filter((module) => module.participatesIn.includes(id))
            .map((module) => module.id);
        const flowModuleIds = new Set(flowModules);
        return {
            id,
            modules: flowModules,
            edges: edges
                .filter(
                    (edge) =>
                        flowModuleIds.has(edge.from) &&
                        flowModuleIds.has(edge.to)
                )
                .map((edge) => edge.id)
        };
    });
}

function collectZones(
    modules: readonly TopologyMetadataModule[]
): Array<{id: string; modules: string[]}> {
    const byZone = new Map<string, string[]>();
    for (const zone of KNOWN_TOPOLOGY_ZONES) byZone.set(zone, []);
    for (const module of modules) {
        const zone = topologyZoneFor(module);
        const entries = byZone.get(zone) ?? [];
        entries.push(module.id);
        byZone.set(zone, entries);
    }
    return [...byZone.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, ids]) => ({id, modules: ids.sort()}));
}

function renderTotals(inventory: TopologyMetadataInventory): string {
    return [
        '## Totals',
        '',
        `- Modules: ${inventory.totals.modules}`,
        `- Modules with topology: ${inventory.totals.withTopology}`,
        `- Modules missing topology: ${inventory.totals.missingTopology}`,
        `- Edges: ${inventory.totals.edges}`,
        `- Flows: ${inventory.totals.flows}`,
        `- Zones: ${inventory.totals.zones}`,
        ''
    ].join('\n');
}

function renderZones(inventory: TopologyMetadataInventory): string {
    return [
        '## Zones',
        '',
        '| Zone | Modules |',
        '|---|---:|',
        ...inventory.zones.map(
            (zone) => `| ${mdCodeInline(zone.id)} | ${zone.modules.length} |`
        ),
        ''
    ].join('\n');
}

function renderModules(inventory: TopologyMetadataInventory): string {
    return [
        '## Modules',
        '',
        '| Module | Zone | Role | Kind | Criticality | Data | Flows | Source |',
        '|---|---|---|---|---|---|---|---|',
        ...inventory.modules.map((module) =>
            [
                mdCodeInline(module.id),
                mdCodeInline(topologyZoneFor(module)),
                mdEscape(module.role),
                mdEscape(module.kind || '-'),
                mdEscape(module.criticality || '-'),
                mdEscape(module.dataClasses.join(', ') || '-'),
                mdEscape(module.participatesIn.join(', ') || '-'),
                `${mdEscape(module.sourceFile)}:${module.sourceLine}`
            ].join(' | ')
        ),
        ''
    ].join('\n');
}

function topologyZoneFor(module: TopologyMetadataModule): string {
    return module.zone || ZONE_BY_CLUSTER[module.cluster] || 'unclassified';
}

function renderEdges(inventory: TopologyMetadataInventory): string {
    return [
        '## Edges',
        '',
        '| Edge | Declared By |',
        '|---|---|',
        ...inventory.edges.map(
            (edge) =>
                `| ${mdCodeInline(edge.id)} | ${mdCodeInline(edge.declaredBy)} |`
        ),
        ''
    ].join('\n');
}

function renderFlows(inventory: TopologyMetadataInventory): string {
    return [
        '## Flows',
        '',
        '| Flow | Modules | Edges |',
        '|---|---:|---:|',
        ...inventory.flows.map(
            (flow) =>
                `| ${mdCodeInline(flow.id)} | ${flow.modules.length} | ${flow.edges.length} |`
        ),
        '',
        ...inventory.flows.flatMap((flow) => [
            `### ${flow.id}`,
            '',
            `Modules: ${flow.modules.map(mdCodeInline).join(', ') || '-'}`,
            '',
            `Edges: ${flow.edges.map(mdCodeInline).join(', ') || '-'}`,
            ''
        ])
    ].join('\n');
}

function renderMermaid(
    modules: readonly TopologyMetadataModule[],
    edges: readonly TopologyMetadataEdge[]
): string {
    const lines = ['flowchart LR'];
    const moduleIds = new Set(modules.map((module) => module.id));
    for (const module of modules) {
        lines.push(
            `  ${safeMermaidId(module.id)}["${escapeMermaidLabel(module.label)}"]`
        );
    }
    for (const edge of edges) {
        const from = safeMermaidId(edge.from);
        const to = safeMermaidId(edge.to);
        if (!moduleIds.has(edge.from)) {
            lines.push(`  ${from}["${escapeMermaidLabel(edge.from)}"]`);
        }
        if (!moduleIds.has(edge.to)) {
            lines.push(`  ${to}["${escapeMermaidLabel(edge.to)}"]`);
        }
        lines.push(`  ${from} --> ${to}`);
    }
    return `${lines.join('\n')}\n`;
}

function safeMermaidId(id: string): string {
    return id.replace(/[^A-Za-z0-9_]/g, '_');
}

function escapeMermaidLabel(label: string): string {
    return label.replace(/"/g, '\\"');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const inventory = generate();
    process.stdout.write(renderMarkdown(inventory));
}
