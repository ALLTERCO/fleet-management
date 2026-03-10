import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import * as log4js from 'log4js';
import type {config_rc_t} from '.';
import {CFG_FOLDER, STATIC_FOLDER} from '.';

const logger = log4js.getLogger();

const BASE_DB_CONFIG = {
    database: '',
    host: '',
    port: '',
    user: '',
    password: ''
};

const GRAFANA_TEMPLATES_FOLDER = join(STATIC_FOLDER, 'grafana');

async function grafana(
    config: {endpoint: string},
    dbConfig: {
        database: string;
        host: string;
        port: string;
        user: string;
        password: string;
    }
) {
    try {
        const folders = await (
            await fetch(`${config.endpoint}/api/folders`)
        ).json();
        const folder = folders.find(
            ({title}: {title: string}) => title === 'Fleet Manager'
        );
        if (folder) {
            logger.warn("Grafana 'Fleet Manager' folder already exists.");
            return;
        }
        const dsNew = await (
            await fetch(`${config.endpoint}/api/datasources`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: 'fm',
                    type: 'grafana-postgresql-datasource',
                    access: 'proxy',
                    url: dbConfig.host + (dbConfig.port && `:${dbConfig.port}`),
                    user: dbConfig.user,
                    secureJsonData: {
                        password: dbConfig.password
                    },
                    jsonData: {
                        database: dbConfig.database,
                        sslmode: 'disable',
                        maxOpenConns: 10,
                        maxIdleConns: 10,
                        maxIdleConnsAuto: true,
                        connMaxLifetime: 14400,
                        postgresVersion: 1000,
                        timescaledb: true
                    }
                })
            })
        ).json();

        const folderNew = await (
            await fetch(`${config.endpoint}/api/folders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title: 'Fleet Manager'
                })
            })
        ).json();
        const files = await readdir(GRAFANA_TEMPLATES_FOLDER);
        logger.debug('grafana templates:', files.join(', '));
        const dashboards = await Promise.all(
            files.map(async (dashName: string, key: number) => {
                const dashboardContent = JSON.parse(
                    (
                        await readFile(join(GRAFANA_TEMPLATES_FOLDER, dashName))
                    ).toString('utf8')
                );
                // This are exported in the grafana template, but make
                // errors when trying to upload them
                dashboardContent.id = undefined;
                dashboardContent.uid = undefined;

                const dashboardNew = await (
                    await fetch(`${config.endpoint}/api/dashboards/db`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            dashboard: dashboardContent,
                            folderUid: folderNew.uid,
                            message: `new dashboard ${key}`,
                            overwrite: false
                        })
                    })
                ).json();
                return dashboardNew;
            })
        );

        await writeFile(
            join(CFG_FOLDER, 'grafana', 'config.json'),
            JSON.stringify({
                ds: dsNew,
                folder: folderNew,
                dashboards
            }),
            {flag: 'w'}
        );
    } catch (e: any) {
        // fetch failures (DNS, connection refused) mean Grafana isn't reachable yet —
        // this is expected when starting without Grafana or before it's healthy
        if (
            e?.cause?.code === 'EAI_AGAIN' ||
            e?.cause?.code === 'ECONNREFUSED'
        ) {
            logger.warn(
                'Grafana not reachable at %s — skipping dashboard setup',
                config.endpoint
            );
        } else {
            logger.error('Grafana setup failed:', e);
        }
    }
}

export default async (config: config_rc_t) => {
    const grafanaConfig = config.graphs?.grafana;
    if (!grafanaConfig || !grafanaConfig.endpoint) {
        return;
    }
    return await grafana(
        grafanaConfig,
        Object.assign(BASE_DB_CONFIG, config.internalStorage?.connection)
    );
};
