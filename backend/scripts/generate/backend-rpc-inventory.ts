/**
 * Backend RPC inventory generator (Phase 0a).
 *
 * Uses the real TypeScript Program to scan every class that extends
 * `Component` and record:
 *   - explicit @Component.Expose(...) methods (with permission decorators)
 *   - inherited base-class methods (ListMethods, getstatus/getconfig/setconfig)
 *   - DEV_MODE-only methods (readconfig/writeconfig/resetconfig)
 *   - composition-root registrations (app.ts + user/index.ts)
 *
 * Does NOT include runtime plugin-generated methods — those require a boot
 * snapshot, captured manually into docs/generated/runtime-plugin-inventory.md.
 *
 * Output: docs/generated/backend-rpc-inventory.{json,md}
 */

import * as path from 'node:path';
import ts from 'typescript';
import {
    BACKEND_SRC,
    decoratorsOf,
    FRONTEND_SRC,
    getBackendProgram,
    getBackendSourceFiles,
    lineOf,
    mdEscape,
    nodeText,
    type ParsedDecorator,
    provenanceHeader,
    readFile,
    readStringArg,
    relPath,
    walkFiles,
    writeOutputs
} from './_shared.js';

const PERMISSION_DECORATOR_NAMES = new Set([
    'NoPermissions',
    'ReadOnly',
    'WriteOperation',
    'CrudPermission',
    'CheckPermissions'
]);

// One permission decorator per method — last-wins would silently
// under-report enforcement in the inventory, catalog, and drift gate.
export function pickPermissionDecorator(
    method: string,
    perms: ParsedDecorator[]
): ParsedDecorator | undefined {
    if (perms.length > 1) {
        throw new Error(
            `${method}: stacked permission decorators are not supported — extend the permission model before adding a second one`
        );
    }
    return perms[0];
}

// --- Types ---------------------------------------------------------------

export type MethodKind =
    | 'explicit'
    | 'inherited-list-methods'
    | 'inherited-getstatus'
    | 'inherited-getconfig'
    | 'inherited-setconfig'
    | 'dev-readconfig'
    | 'dev-writeconfig'
    | 'dev-resetconfig';

export type EnvScope = 'production' | 'dev-mode' | 'runtime-plugin';

export type PermissionKind =
    | 'NoPermissions'
    | 'ReadOnly'
    | 'WriteOperation'
    | 'CrudPermission'
    | 'CheckPermissions'
    | 'inherited-fallback';

export interface RpcMethod {
    namespace: string;
    method: string;
    kind: MethodKind;
    env: EnvScope;
    permission: PermissionKind;
    permissionArgs?: string;
    hasCheckParams: boolean;
    sourceFile: string;
    sourceLine: number;
    frontendCallers: number;
}

export interface RpcComponent {
    namespace: string;
    className: string;
    sourceFile: string;
    sourceLine: number;
    setConfigMethods: boolean;
    deletesSetConfig: boolean;
    registeredIn: string;
}

export interface RpcInventory {
    generator: 'backend-rpc-inventory';
    version: 1;
    totals: {
        components: number;
        explicitMethods: number;
        inheritedMethods: number;
        devModeMethods: number;
        productionCallable: number;
        devModeCallable: number;
    };
    components: RpcComponent[];
    methods: RpcMethod[];
}

// --- Scanner -------------------------------------------------------------

interface ScannedComponent {
    namespace: string;
    className: string;
    sourceFile: string;
    sourceLine: number;
    setConfigMethods: boolean;
    deletesSetConfig: boolean;
    methods: RpcMethod[];
}

/** Does this class declaration extend `Component` (directly)? */
function extendsComponent(cls: ts.ClassDeclaration): boolean {
    if (!cls.heritageClauses) return false;
    for (const clause of cls.heritageClauses) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
        for (const type of clause.types) {
            const expr = type.expression;
            // handles `extends Component` and `extends Component<T>`
            if (ts.isIdentifier(expr) && expr.text === 'Component') {
                return true;
            }
        }
    }
    return false;
}

/** Extract super(...) call + this.methods.delete('setconfig') from a constructor */
function extractConstructorInfo(cls: ts.ClassDeclaration): {
    namespace: string | undefined;
    setConfigMethods: boolean;
    deletesSetConfig: boolean;
} {
    let namespace: string | undefined;
    let setConfigMethods = true;
    let deletesSetConfig = false;

    for (const member of cls.members) {
        if (!ts.isConstructorDeclaration(member) || !member.body) continue;
        ts.forEachChild(member.body, function visit(node) {
            // super('namespace', props?)
            if (
                ts.isExpressionStatement(node) &&
                ts.isCallExpression(node.expression) &&
                node.expression.expression.kind === ts.SyntaxKind.SuperKeyword
            ) {
                const [nsArg, propsArg] = node.expression.arguments;
                namespace = readStringArg(nsArg);
                if (propsArg && ts.isObjectLiteralExpression(propsArg)) {
                    for (const prop of propsArg.properties) {
                        if (
                            ts.isPropertyAssignment(prop) &&
                            ts.isIdentifier(prop.name) &&
                            prop.name.text === 'set_config_methods' &&
                            prop.initializer.kind === ts.SyntaxKind.FalseKeyword
                        ) {
                            setConfigMethods = false;
                        }
                    }
                }
            }
            // this.methods.delete('setconfig')
            if (
                ts.isExpressionStatement(node) &&
                ts.isCallExpression(node.expression) &&
                ts.isPropertyAccessExpression(node.expression.expression) &&
                node.expression.expression.name.text === 'delete'
            ) {
                const methodsAccess = node.expression.expression.expression;
                if (
                    ts.isPropertyAccessExpression(methodsAccess) &&
                    methodsAccess.expression.kind ===
                        ts.SyntaxKind.ThisKeyword &&
                    methodsAccess.name.text === 'methods'
                ) {
                    const [keyArg] = node.expression.arguments;
                    const key = readStringArg(keyArg);
                    if (key?.toLowerCase() === 'setconfig') {
                        deletesSetConfig = true;
                    }
                }
            }
            ts.forEachChild(node, visit);
        });
    }

    return {namespace, setConfigMethods, deletesSetConfig};
}

function extractExplicitMethods(
    cls: ts.ClassDeclaration,
    namespace: string,
    source: ts.SourceFile
): RpcMethod[] {
    const out: RpcMethod[] = [];
    for (const member of cls.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const decorators = decoratorsOf(member);
        if (decorators.length === 0) continue;

        let methodName: string | undefined;
        let hasCheckParams = false;
        const permissionDecorators: ParsedDecorator[] = [];

        for (const dec of decorators) {
            if (dec.namespace !== 'Component') continue;
            if (dec.name === 'Expose') {
                methodName = readStringArg(dec.args[0]);
            } else if (dec.name === 'CheckParams') {
                hasCheckParams = true;
            } else if (PERMISSION_DECORATOR_NAMES.has(dec.name)) {
                permissionDecorators.push(dec);
            }
        }

        if (!methodName) continue;
        const permDecorator = pickPermissionDecorator(
            `${namespace}.${methodName}`,
            permissionDecorators
        );
        const permission: PermissionKind =
            (permDecorator?.name as PermissionKind) ?? 'inherited-fallback';
        const permissionArgs =
            permDecorator &&
            (permDecorator.name === 'CrudPermission' ||
                permDecorator.name === 'CheckPermissions')
                ? summarizeArgs(permDecorator.args, source)
                : undefined;
        out.push({
            namespace,
            method: methodName,
            kind: 'explicit',
            env: 'production',
            permission,
            permissionArgs,
            hasCheckParams,
            sourceFile: relPath(source.fileName),
            sourceLine: lineOf(member, source),
            frontendCallers: 0
        });
    }
    return out;
}

function summarizeArgs(
    args: readonly ts.Expression[],
    source: ts.SourceFile
): string {
    return args
        .map((a) => nodeText(a, source).replace(/\s+/g, ' '))
        .join(', ')
        .slice(0, 140);
}

function scanComponentSource(
    source: ts.SourceFile
): ScannedComponent | undefined {
    let found: ScannedComponent | undefined;
    ts.forEachChild(source, (node) => {
        if (found) return;
        if (!ts.isClassDeclaration(node) || !node.name) return;
        if (!extendsComponent(node)) return;

        const {namespace, setConfigMethods, deletesSetConfig} =
            extractConstructorInfo(node);
        if (!namespace) return;

        found = {
            namespace,
            className: node.name.text,
            sourceFile: relPath(source.fileName),
            sourceLine: lineOf(node, source),
            setConfigMethods,
            deletesSetConfig,
            methods: extractExplicitMethods(node, namespace, source)
        };
    });
    return found;
}

function buildInheritedMethods(scanned: ScannedComponent): RpcMethod[] {
    const out: RpcMethod[] = [];
    const push = (
        method: string,
        kind: MethodKind,
        env: EnvScope = 'production'
    ) => {
        out.push({
            namespace: scanned.namespace,
            method,
            kind,
            env,
            permission: 'inherited-fallback',
            hasCheckParams: false,
            sourceFile: 'backend/src/model/component/Component.ts',
            sourceLine: 104,
            frontendCallers: 0
        });
    };
    push('ListMethods', 'inherited-list-methods');
    if (scanned.setConfigMethods) {
        push('getstatus', 'inherited-getstatus');
        push('getconfig', 'inherited-getconfig');
        if (!scanned.deletesSetConfig) {
            push('setconfig', 'inherited-setconfig');
        }
    }
    // DEV_MODE always adds these three
    push('readconfig', 'dev-readconfig', 'dev-mode');
    push('writeconfig', 'dev-writeconfig', 'dev-mode');
    push('resetconfig', 'dev-resetconfig', 'dev-mode');
    return out;
}

/**
 * Find registration sites: any `new ClassComponent()` followed by (anywhere)
 * `registerComponent(<identifier or expression>)` in the same file counts as
 * that class being registered. Handles both:
 *   `Commander.registerComponent(new FooComponent())` (inline)
 *   `const x = new FooComponent(); Commander.registerComponent(x)` (via variable)
 */
function findRegistrationSites(program: ts.Program): Map<string, string> {
    const map = new Map<string, string>();
    const targets = [
        path.join(BACKEND_SRC, 'app.ts'),
        path.join(BACKEND_SRC, 'modules/user/index.ts')
    ];
    for (const target of targets) {
        const source = program.getSourceFile(target);
        if (!source) continue;
        const sourceFileName = source.fileName;

        // Collect every class name instantiated via `new ClassName(...)` in this file
        const instantiatedClasses = new Set<string>();
        const hasRegisterComponentCall = {value: false};

        const visit = (node: ts.Node): void => {
            if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
                instantiatedClasses.add(node.expression.text);
            }
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === 'registerComponent'
            ) {
                hasRegisterComponentCall.value = true;
                // Inline case: registerComponent(new FooComponent())
                const [arg] = node.arguments;
                if (
                    arg &&
                    ts.isNewExpression(arg) &&
                    ts.isIdentifier(arg.expression)
                ) {
                    map.set(arg.expression.text, relPath(sourceFileName));
                }
            }
            ts.forEachChild(node, visit);
        };
        ts.forEachChild(source, visit);

        // Variable-indirection case: if the file calls registerComponent() at all,
        // any class it instantiates in the same file is treated as registered here.
        if (hasRegisterComponentCall.value) {
            for (const cls of instantiatedClasses) {
                if (!map.has(cls)) map.set(cls, relPath(sourceFileName));
            }
        }
    }
    return map;
}

/** Count frontend call sites that reference `namespace.method` (case-insensitive) */
function buildFrontendCallerIndex(): Map<string, number> {
    const counts = new Map<string, number>();
    const files = walkFiles(FRONTEND_SRC, ['.ts', '.vue', '.js']);
    const patterns: RegExp[] = [
        // sendRPC(dst, 'Namespace.Method'  OR sendRPC('FLEET_MANAGER', 'Ns.Method'
        /sendRPC\s*\(\s*[^,)]+,\s*['"]([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g,
        // HTTP: /rpc/Namespace.Method
        /\/rpc\/([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g,
        // useWsRpc-style: {method: 'Ns.Method'}
        /method\s*:\s*['"]([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g
    ];
    for (const file of files) {
        let content: string;
        try {
            content = readFile(file);
        } catch {
            continue;
        }
        for (const re of patterns) {
            re.lastIndex = 0;
            for (const m of content.matchAll(re)) {
                const key = `${m[1].toLowerCase()}.${m[2].toLowerCase()}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
    }
    return counts;
}

// --- Main ----------------------------------------------------------------

export function generate(): RpcInventory {
    const program = getBackendProgram();
    const allSources = getBackendSourceFiles(program);

    // Scan model/component/ plus any modules/<x>/*Component.ts (user, mobile,
    // identity, ...) so components living outside model/component are not
    // silently dropped from the inventory.
    const componentSources = allSources.filter(
        (sf) =>
            sf.fileName.includes(path.join('model', 'component')) ||
            (sf.fileName.includes(`${path.sep}modules${path.sep}`) &&
                sf.fileName.endsWith('Component.ts'))
    );

    const registrations = findRegistrationSites(program);
    const frontendCallers = buildFrontendCallerIndex();

    const components: RpcComponent[] = [];
    const methods: RpcMethod[] = [];

    for (const source of componentSources) {
        const scanned = scanComponentSource(source);
        if (!scanned) continue;

        const registeredIn =
            registrations.get(scanned.className) ?? '(not registered at boot)';

        components.push({
            namespace: scanned.namespace,
            className: scanned.className,
            sourceFile: scanned.sourceFile,
            sourceLine: scanned.sourceLine,
            setConfigMethods: scanned.setConfigMethods,
            deletesSetConfig: scanned.deletesSetConfig,
            registeredIn
        });

        const attach = (m: RpcMethod): RpcMethod => ({
            ...m,
            frontendCallers:
                frontendCallers.get(
                    `${scanned.namespace.toLowerCase()}.${m.method.toLowerCase()}`
                ) ?? 0
        });

        methods.push(...scanned.methods.map(attach));
        methods.push(...buildInheritedMethods(scanned).map(attach));
    }

    components.sort((a, b) => a.namespace.localeCompare(b.namespace));
    methods.sort((a, b) => {
        if (a.namespace !== b.namespace)
            return a.namespace.localeCompare(b.namespace);
        if (a.env !== b.env) return a.env.localeCompare(b.env);
        return a.method.localeCompare(b.method);
    });

    const explicit = methods.filter((m) => m.kind === 'explicit').length;
    const inherited = methods.filter(
        (m) => m.env === 'production' && m.kind !== 'explicit'
    ).length;
    const dev = methods.filter((m) => m.env === 'dev-mode').length;

    return {
        generator: 'backend-rpc-inventory',
        version: 1,
        totals: {
            components: components.length,
            explicitMethods: explicit,
            inheritedMethods: inherited,
            devModeMethods: dev,
            productionCallable: explicit + inherited,
            devModeCallable: explicit + inherited + dev
        },
        components,
        methods
    };
}

export function renderMarkdown(inv: RpcInventory): string {
    const header = provenanceHeader('Backend RPC Inventory', [
        'backend/src/model/component/*.ts',
        'backend/src/modules/user/UserComponent.ts',
        'backend/src/app.ts'
    ]);

    const t = inv.totals;
    const summary = [
        '## Totals',
        '',
        `- Components registered at boot: **${t.components}**`,
        `- Explicit \`@Component.Expose\` methods: **${t.explicitMethods}**`,
        `- Inherited base-class methods: **${t.inheritedMethods}**`,
        `- DEV_MODE extras: **${t.devModeMethods}**`,
        `- Production callable total: **${t.productionCallable}**`,
        `- DEV_MODE callable total: **${t.devModeCallable}**`,
        '',
        '> Runtime plugin-generated methods not included — see',
        '> `docs/generated/runtime-plugin-inventory.md` (hand-produced per release).',
        ''
    ].join('\n');

    const componentTable = [
        '## Components',
        '',
        '| Namespace | Class | File:Line | Set-config methods | Deletes `setconfig` | Registered in |',
        '|---|---|---|---|---|---|',
        ...inv.components.map(
            (c) =>
                `| \`${c.namespace}\` | ${c.className} | [${c.sourceFile}:${c.sourceLine}](../../${c.sourceFile}#L${c.sourceLine}) | ${c.setConfigMethods ? 'yes' : 'no'} | ${c.deletesSetConfig ? 'yes' : 'no'} | ${c.registeredIn} |`
        ),
        ''
    ].join('\n');

    const byNamespace = new Map<string, RpcMethod[]>();
    for (const m of inv.methods) {
        const list = byNamespace.get(m.namespace) ?? [];
        list.push(m);
        byNamespace.set(m.namespace, list);
    }

    const perNamespace: string[] = ['## Methods by namespace', ''];
    for (const [ns, list] of [...byNamespace.entries()].sort((a, b) =>
        a[0].localeCompare(b[0])
    )) {
        const expl = list.filter((m) => m.kind === 'explicit').length;
        const inh = list.filter(
            (m) => m.env === 'production' && m.kind !== 'explicit'
        ).length;
        perNamespace.push(
            `### \`${ns}\` — ${expl} explicit + ${inh} inherited (${list.length} total incl. DEV_MODE)`
        );
        perNamespace.push('');
        perNamespace.push(
            '| Method | Kind | Env | Permission | Args | Params | Callers | Source |'
        );
        perNamespace.push('|---|---|---|---|---|---|---|---|');
        for (const m of list) {
            perNamespace.push(
                `| \`${m.method}\` | ${m.kind} | ${m.env} | ${m.permission} | ${mdEscape(m.permissionArgs ?? '')} | ${m.hasCheckParams ? 'schema' : ''} | ${m.frontendCallers} | [${m.sourceFile}:${m.sourceLine}](../../${m.sourceFile}#L${m.sourceLine}) |`
            );
        }
        perNamespace.push('');
    }

    return [header, summary, componentTable, perNamespace.join('\n')].join(
        '\n'
    );
}

// --- Entry point ---------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
    const inv = generate();
    writeOutputs('backend-rpc-inventory', inv, renderMarkdown(inv));
    const t = inv.totals;
    console.log(
        `[backend-rpc-inventory] ${t.components} components | ${t.explicitMethods} explicit + ${t.inheritedMethods} inherited = ${t.productionCallable} prod | +${t.devModeMethods} DEV = ${t.devModeCallable} total`
    );
}
