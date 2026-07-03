import {createHash} from 'node:crypto';
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import * as log4js from 'log4js';
import {type config_rc_t, tuning} from '.';
import {
    FLEET_MANAGER_FOLDER_TITLE,
    findFleetManagerFolder,
    GrafanaApiError,
    type GrafanaIdentity,
    grafanaAuthProxyHeaders,
    isGrafanaFoldersResponse,
    isGrafanaUnavailableError,
    waitForGrafanaReady
} from './grafanaApi';
import {CFG_FOLDER, STATIC_FOLDER} from './paths';

const logger = log4js.getLogger();

const BASE_DB_CONFIG = {
    database: '',
    host: '',
    port: '',
    user: '',
    password: ''
};

const GRAFANA_TEMPLATES_FOLDER = join(STATIC_FOLDER, 'grafana');
const FLEET_DATASOURCE_NAME = 'fm';

// Admin identity FM asserts to Grafana's auth-proxy when provisioning at boot.
const PROVISIONING_IDENTITY: GrafanaIdentity = {
    username: 'fleet-manager',
    role: 'Admin',
    displayName: 'Fleet Manager'
};

interface GrafanaConfigCache {
    ds?: unknown;
    folder?: {uid?: string};
    dashboards?: Array<{slug?: string; uid?: string; hash?: string}>;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    // Bounded timeout — initGrafana sits in the boot path. Auth via the same
    // auth-proxy headers the browser proxy uses, as the provisioning admin.
    const response = await fetch(url, {
        ...init,
        headers: {
            ...grafanaAuthProxyHeaders(PROVISIONING_IDENTITY),
            ...init?.headers
        },
        signal: AbortSignal.timeout(tuning.grafana.fetchTimeoutMs)
    });
    if (!response.ok) {
        throw new GrafanaApiError(response.status, response.statusText);
    }
    return await response.json();
}

function asNamedArray(value: unknown): Array<{name?: string}> {
    return Array.isArray(value)
        ? value.filter(
              (item): item is {name?: string} =>
                  typeof item === 'object' && item !== null
          )
        : [];
}

function hashTemplate(content: unknown): string {
    return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

async function readCachedConfig(): Promise<GrafanaConfigCache> {
    try {
        const raw = await readFile(
            join(CFG_FOLDER, 'grafana', 'config.json'),
            'utf-8'
        );
        return JSON.parse(raw) as GrafanaConfigCache;
    } catch (err: any) {
        if (err?.code === 'ENOENT') return {};
        throw err;
    }
}

async function writeCachedConfig(cache: GrafanaConfigCache): Promise<void> {
    await mkdir(join(CFG_FOLDER, 'grafana'), {recursive: true});
    await writeFile(
        join(CFG_FOLDER, 'grafana', 'config.json'),
        JSON.stringify(cache),
        {flag: 'w'}
    );
}

async function ensureDatasource(
    endpoint: string,
    dbConfig: typeof BASE_DB_CONFIG
): Promise<unknown> {
    const existing = asNamedArray(
        await fetchJson(`${endpoint}/api/datasources`).catch(() => [])
    );
    const found = existing.find((d) => d.name === FLEET_DATASOURCE_NAME);
    if (found) return found;
    return fetchJson(`${endpoint}/api/datasources`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            name: FLEET_DATASOURCE_NAME,
            type: 'grafana-postgresql-datasource',
            access: 'proxy',
            url: dbConfig.host + (dbConfig.port && `:${dbConfig.port}`),
            user: dbConfig.user,
            secureJsonData: {password: dbConfig.password},
            jsonData: {
                database: dbConfig.database,
                sslmode: 'disable',
                maxOpenConns: tuning.grafana.dsMaxOpenConns,
                maxIdleConns: tuning.grafana.dsMaxIdleConns,
                maxIdleConnsAuto: true,
                connMaxLifetime: tuning.grafana.dsConnLifetimeSec,
                postgresVersion: 1500,
                timescaledb: true
            }
        })
    });
}

async function ensureFolder(endpoint: string): Promise<{uid: string}> {
    const folders = await fetchJson(`${endpoint}/api/folders`);
    if (!isGrafanaFoldersResponse(folders)) {
        throw new Error('Grafana folder API returned unexpected shape');
    }
    const existing = findFleetManagerFolder(folders);
    if (existing?.uid) return {uid: existing.uid};
    const created = (await fetchJson(`${endpoint}/api/folders`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title: FLEET_MANAGER_FOLDER_TITLE})
    })) as {uid: string};
    if (typeof created.uid !== 'string') {
        throw new Error('Grafana folder creation returned no uid');
    }
    return {uid: created.uid};
}

async function readTemplates(): Promise<
    Array<{name: string; content: any; hash: string}>
> {
    const files = await readdir(GRAFANA_TEMPLATES_FOLDER);
    return Promise.all(
        files.map(async (name) => {
            const raw = await readFile(
                join(GRAFANA_TEMPLATES_FOLDER, name),
                'utf8'
            );
            const content = JSON.parse(raw);
            // Grafana exports these but rejects them on create/update.
            content.id = undefined;
            content.uid = undefined;
            return {name, content, hash: hashTemplate(content)};
        })
    );
}

async function syncDashboards(
    endpoint: string,
    folderUid: string,
    cached: GrafanaConfigCache
): Promise<Array<{slug: string; uid?: string; hash: string}>> {
    const templates = await readTemplates();
    const cachedByName = new Map(
        (cached.dashboards ?? []).map((d) => [d.slug ?? '', d])
    );
    const out: Array<{slug: string; uid?: string; hash: string}> = [];
    for (const t of templates) {
        const slug = t.name.replace(/\.json$/, '');
        const prior = cachedByName.get(slug);
        if (prior?.hash === t.hash) {
            // Unchanged since last push — skip API call.
            out.push({slug, uid: prior.uid, hash: t.hash});
            continue;
        }
        const result = (await fetchJson(`${endpoint}/api/dashboards/db`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                dashboard: prior?.uid
                    ? {...t.content, uid: prior.uid}
                    : t.content,
                folderUid,
                message: prior ? `update ${slug}` : `create ${slug}`,
                overwrite: true
            })
        })) as {uid?: string};
        logger.info(
            'Grafana dashboard %s %s',
            slug,
            prior ? 'updated' : 'created'
        );
        out.push({slug, uid: result.uid, hash: t.hash});
    }
    return out;
}

async function runGrafanaSetup(
    config: {endpoint: string},
    dbConfig: typeof BASE_DB_CONFIG
) {
    const cached = await readCachedConfig();
    const ds = await ensureDatasource(config.endpoint, dbConfig);
    const folder = await ensureFolder(config.endpoint);
    const dashboards = await syncDashboards(
        config.endpoint,
        folder.uid,
        cached
    );
    await writeCachedConfig({ds, folder, dashboards});
}

// True when Grafana's health endpoint answers; any failure means not-ready.
async function probeGrafanaHealth(endpoint: string): Promise<boolean> {
    try {
        const res = await fetch(`${endpoint}/api/health`, {
            signal: AbortSignal.timeout(tuning.grafana.fetchTimeoutMs)
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function grafana(
    config: {endpoint: string},
    dbConfig: typeof BASE_DB_CONFIG
) {
    const ready = await waitForGrafanaReady({
        timeoutMs: tuning.grafana.setupReadyTimeoutMs,
        pollIntervalMs: tuning.grafana.setupReadyPollMs,
        probe: () => probeGrafanaHealth(config.endpoint)
    });
    if (!ready) {
        logger.warn(
            'Grafana not ready within %dms at %s — skipping dashboard setup',
            tuning.grafana.setupReadyTimeoutMs,
            config.endpoint
        );
        return;
    }
    try {
        await runGrafanaSetup(config, dbConfig);
        logger.info('Grafana dashboard setup complete');
    } catch (e: any) {
        if (isGrafanaUnavailableError(e)) {
            logger.warn('Grafana became unavailable during setup — skipping');
        } else {
            logger.error('Grafana setup failed: %s', e);
        }
    }
}

export default async (config: config_rc_t) => {
    const grafanaConfig = config.graphs?.grafana;
    if (!grafanaConfig?.endpoint) {
        return;
    }
    return await grafana(grafanaConfig, {
        ...BASE_DB_CONFIG,
        ...config.internalStorage?.connection,
        port: String(
            config.internalStorage?.connection?.port ?? BASE_DB_CONFIG.port
        )
    });
};
