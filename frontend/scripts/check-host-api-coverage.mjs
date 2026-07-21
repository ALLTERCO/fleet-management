import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(ROOT, '..');
const GOLDEN_DIR = path.join(REPO_ROOT, 'backend/test/fixtures/golden');
const API_SOURCE = path.join(ROOT, 'src/shell/template-host/api.ts');
const HOST_DIR = path.join(ROOT, 'src/shell/template-host');
const FRONTEND_SRC = path.join(ROOT, 'src');

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

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        fail(`cannot read ${path.relative(REPO_ROOT, file)}: ${err.message}`);
    }
}

function rpcMethod(namespace, method) {
    return `${namespace}.${method}`.toLowerCase();
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

if (!fs.existsSync(GOLDEN_DIR)) {
    fail('backend Describe golden directory is missing');
}
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

const files = fs
    .readdirSync(GOLDEN_DIR)
    .filter((file) => file.endsWith('.Describe.golden.json'))
    .sort();

const publicMethods = [];
for (const file of files) {
    const describe = readJson(path.join(GOLDEN_DIR, file));
    if (!describe.namespace || typeof describe.namespace !== 'string') {
        fail(`${file} has no namespace`);
    }
    if (!describe.methods || typeof describe.methods !== 'object') {
        fail(`${file} has no methods object`);
    }
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

// Contract must exist; freshness is enforced by the backend host-contract gate.
const CONTRACT = path.join(HOST_DIR, 'generated/contract.ts');
if (!fs.existsSync(CONTRACT)) {
    fail('generated host contract is missing — cd backend && npm run generate');
}

checkHostBypassImports();
checkProtectedRawRpcCalls();

console.log(
    `Host API coverage passed: ${unique.size} Describe methods exposed by the ` +
        'generic @host/api, domain modules present, typed contract present, protected RPCs guarded'
);
