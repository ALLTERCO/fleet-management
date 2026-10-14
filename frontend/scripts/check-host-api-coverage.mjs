import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(ROOT, '..');
const DESCRIBE_DIR = path.join(REPO_ROOT, 'backend/src/types/api');
const API_SOURCE = path.join(ROOT, 'src/shell/template-host/api.ts');
const HOST_DIR = path.join(ROOT, 'src/shell/template-host');
const FRONTEND_SRC = path.join(ROOT, 'src');
const CONTRACT = path.join(HOST_DIR, 'generated/contract.ts');

const REQUIRED_DOMAIN_MODULES = [
    'api',
    'auth',
    'permissions',
    'customization',
    'navigation',
    'devices',
    'relationships',
    'virtualDevices',
    'bluetoothDevices',
    'entities',
    'locations',
    'groups',
    'tags',
    'alerts',
    'dashboards',
    'configurations',
    'firmware',
    'backups',
    'users',
    'audit',
    'reports',
    'channels',
    'notifications',
    'settings',
    'waiting-room'
];

const FORBIDDEN_HOST_BYPASS_IMPORTS = [
    '@/api/virtualDeviceRpc',
    '@/api/deviceRelationshipsRpc',
    '@/api/bthomeRpc',
    '@api/assetRole'
];

const RAW_FLEET_MANAGER_RPC_PATTERN =
    /\bsendRPC\s*(?:<[^>]*>)?\(\s*(?:['"]FLEET_MANAGER['"]|FM)\s*,\s*['"]([^'"]+)['"]/g;

const PROTECTED_RAW_RPC_METHODS = [
    /^virtualdevice\./i,
    /^device\.relationships\./i,
    /^bthome\.(?:listgateways|device\.rename)$/i,
    /^device\.(?:delete|setkind|setimage|getimage)$/i
];

function fail(message) {
    console.error(`Host API coverage failed: ${message}`);
    process.exit(1);
}

function rpcMethod(namespace, method) {
    return `${namespace}.${method}`.toLowerCase();
}

function describeSourceFiles() {
    if (!fs.existsSync(DESCRIBE_DIR)) {
        fail('backend Describe source directory is missing');
    }
    return fs
        .readdirSync(DESCRIBE_DIR)
        .filter(
            (file) =>
                file.endsWith('.ts') &&
                !file.startsWith('_') &&
                file !== 'index.ts'
        )
        .sort()
        .map((file) => path.join(DESCRIBE_DIR, file));
}

async function loadLiveDescribes() {
    const byNamespace = new Map();
    for (const file of describeSourceFiles()) {
        let mod;
        try {
            mod = await import(pathToFileURL(file).href);
        } catch (err) {
            fail(
                `cannot load ${path.relative(REPO_ROOT, file)}: ${err instanceof Error ? err.message : String(err)}`
            );
        }
        for (const [exportName, candidate] of Object.entries(mod)) {
            if (!exportName.endsWith('_DESCRIBE')) continue;
            if (
                !candidate ||
                typeof candidate !== 'object' ||
                typeof candidate.namespace !== 'string' ||
                !candidate.methods ||
                typeof candidate.methods !== 'object'
            ) {
                fail(
                    `${path.relative(REPO_ROOT, file)} export ${exportName} is not a valid Describe contract`
                );
            }
            if (byNamespace.has(candidate.namespace)) {
                fail(`duplicate Describe namespace ${candidate.namespace}`);
            }
            byNamespace.set(candidate.namespace, candidate);
        }
    }
    if (byNamespace.size === 0) {
        fail('no backend Describe contracts found');
    }
    return [...byNamespace.values()].sort((a, b) =>
        a.namespace.localeCompare(b.namespace)
    );
}

function generatedContractMethodIds() {
    if (!fs.existsSync(CONTRACT)) {
        fail('generated host contract is missing — cd backend && npm run generate');
    }
    const source = fs.readFileSync(CONTRACT, 'utf8');
    const sourceFile = ts.createSourceFile(
        CONTRACT,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const hostContract = sourceFile.statements.find(
        (statement) =>
            ts.isInterfaceDeclaration(statement) &&
            statement.name.text === 'HostContract'
    );
    if (!hostContract) {
        fail('generated host contract has no HostContract interface');
    }
    const ids = [];
    for (const member of hostContract.members) {
        if (!ts.isPropertySignature(member) || !member.name) {
            fail('generated HostContract contains an unexpected member');
        }
        if (ts.isStringLiteral(member.name) || ts.isIdentifier(member.name)) {
            ids.push(member.name.text.toLowerCase());
            continue;
        }
        fail('generated HostContract contains an unsupported method key');
    }
    return ids;
}

export function methodSetDiff(liveMethods, generatedMethods) {
    const live = new Set(liveMethods);
    const generated = new Set(generatedMethods);
    const missing = [...live].filter((method) => !generated.has(method)).sort();
    const stale = [...generated].filter((method) => !live.has(method)).sort();
    return {missing, stale};
}

function compareMethodSets(liveMethods, generatedMethods) {
    const {missing, stale} = methodSetDiff(liveMethods, generatedMethods);
    if (missing.length === 0 && stale.length === 0) return;
    const details = [];
    if (missing.length > 0) {
        details.push(`missing from generated HostContract:\n${missing.join('\n')}`);
    }
    if (stale.length > 0) {
        details.push(`stale in generated HostContract:\n${stale.join('\n')}`);
    }
    fail(
        `generated HostContract does not match live backend Describe surface:\n${details.join('\n')}`
    );
}

function walkSourceFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walkSourceFiles(full));
        else if (/\.(vue|ts|tsx|js|mjs)$/.test(entry.name)) files.push(full);
    }
    return files;
}

function hasImport(source, specifier) {
    return new RegExp(
        `(?:import|export)\\s+(?:type\\s+)?(?:[^'"]*?\\s+from\\s+)?['"]${specifier.replaceAll('/', '\\/')}['"]`
    ).test(source);
}

function checkHostBypassImports() {
    const offenders = [];
    for (const file of walkSourceFiles(FRONTEND_SRC)) {
        const relative = path.relative(ROOT, file);
        if (relative.startsWith('src/api/')) continue;
        if (relative.startsWith('src/shell/template-host/')) continue;
        const source = fs.readFileSync(file, 'utf8');
        for (const specifier of FORBIDDEN_HOST_BYPASS_IMPORTS) {
            if (hasImport(source, specifier)) {
                offenders.push(`${relative} imports ${specifier}`);
            }
        }
    }
    if (offenders.length > 0) {
        fail(
            `use @host relationships/virtualDevices/bluetoothDevices instead:\n${offenders.join('\n')}`
        );
    }
}

function isProtectedRawRpc(method) {
    return PROTECTED_RAW_RPC_METHODS.some((pattern) => pattern.test(method));
}

function findProtectedRawRpcCalls(source) {
    const matches = [];
    RAW_FLEET_MANAGER_RPC_PATTERN.lastIndex = 0;
    for (
        let match = RAW_FLEET_MANAGER_RPC_PATTERN.exec(source);
        match;
        match = RAW_FLEET_MANAGER_RPC_PATTERN.exec(source)
    ) {
        const method = match[1];
        if (isProtectedRawRpc(method)) matches.push(method);
    }
    return matches;
}

function checkProtectedRawRpcCalls() {
    const offenders = [];
    for (const file of walkSourceFiles(FRONTEND_SRC)) {
        const relative = path.relative(ROOT, file);
        if (relative.startsWith('src/api/')) continue;
        if (relative.startsWith('src/shell/template-host/')) continue;
        const source = fs.readFileSync(file, 'utf8');
        for (const method of findProtectedRawRpcCalls(source)) {
            offenders.push(`${relative} calls raw ${method}`);
        }
    }
    if (offenders.length > 0) {
        fail(
            `use @host devices/relationships/virtualDevices/bluetoothDevices instead:\n${offenders.join('\n')}`
        );
    }
}

async function main() {
    if (!fs.existsSync(API_SOURCE)) {
        fail('frontend/src/shell/template-host/api.ts is missing');
    }
    for (const moduleName of REQUIRED_DOMAIN_MODULES) {
        const modulePath = path.join(HOST_DIR, `${moduleName}.ts`);
        if (!fs.existsSync(modulePath)) {
            fail(`missing documented host module @host/${moduleName}`);
        }
    }

    const apiSource = fs.readFileSync(API_SOURCE, 'utf8');
    for (const requiredExport of ['api', 'call', 'listAll', 'toRpcMethod']) {
        if (
            !new RegExp(
                `export\\s+(?:(?:async\\s+)?function|const)\\s+${requiredExport}\\b`
            ).test(apiSource)
        ) {
            fail(`api.ts must export ${requiredExport}`);
        }
    }

    const publicMethods = [];
    for (const describe of await loadLiveDescribes()) {
        for (const [methodName, descriptor] of Object.entries(describe.methods)) {
            if (
                !descriptor?.params ||
                !descriptor?.response ||
                !descriptor?.permission
            ) {
                fail(
                    `${describe.namespace}.${methodName} has incomplete descriptor`
                );
            }
            publicMethods.push(rpcMethod(describe.namespace, methodName));
        }
    }

    const unique = new Set(publicMethods);
    if (unique.size !== publicMethods.length) {
        fail('duplicate Describe method after RPC normalization');
    }

    const generatedMethods = generatedContractMethodIds();
    if (new Set(generatedMethods).size !== generatedMethods.length) {
        fail('duplicate method in generated HostContract');
    }
    compareMethodSets(publicMethods, generatedMethods);

    // Exact schema/type rendering freshness is still enforced by the backend
    // host-contract gate. This frontend check independently pins the complete live
    // method surface so public release snapshots do not depend on test fixtures.

    checkHostBypassImports();
    checkProtectedRawRpcCalls();

    console.log(
        `Host API coverage passed: ${unique.size} live Describe methods match the ` +
            'generated HostContract, generic @host/api is present, domain modules exist, protected RPCs guarded'
    );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
