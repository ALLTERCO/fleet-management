/**
 * Embedded-apps API reference — the Node-RED Admin API and the Grafana API as
 * reached through FM's authenticated proxy. These endpoints belong to the
 * upstream tools (FM only proxies them), so they are curated here rather than
 * derived from FM source — and emitted alongside the generated FM inventories
 * so the full integration surface lives in one place.
 *
 * Pattern: build the payload, POST it through FM's proxy (FM auth + FM injects
 * the upstream credential); the embedded tool then calls FM's `/rpc` (Node-RED
 * `fm-*` nodes) or the read-only `fm` datasource (Grafana).
 */

export interface EmbeddedEndpoint {
    method: string;
    path: string;
    purpose: string;
    /** Copy-paste curl, via FM's proxy. */
    example: string;
}

export interface EmbeddedApp {
    app: string;
    /** Runtime add-on this maps to; the served docs include it only when on. */
    feature: 'grafana' | 'node-red';
    proxyBase: string;
    authExternal: string;
    authInternal: string;
    endpoints: EmbeddedEndpoint[];
}

const NR_AUTH = '-H "Authorization: Bearer <FM_PAT_with_node-red_access>"';
const JSON_H = '-H "Content-Type: application/json"';

const NR_LIST = String.raw`curl ${NR_AUTH} https://<host>/node-red/red/flows`;

const NR_CREATE = String.raw`# Create one flow (tab)
curl -X POST https://<host>/node-red/red/flow \
  ${NR_AUTH} ${JSON_H} \
  -d '{
    "label": "Toggle switch",
    "nodes": [
      {"id":"inj1","type":"inject","name":"every 5s","repeat":"5","once":false,
       "props":[{"p":"payload"}],"payloadType":"date","wires":[["rpc1"]]},
      {"id":"rpc1","type":"fm-rpc","name":"toggle","server":"fmserver1",
       "operation":"entity.InvokeAction","paramsSource":"config",
       "paramsJson":"{\"id\":\"<entityId>\",\"action\":\"toggle\"}","wires":[["dbg1"]]},
      {"id":"dbg1","type":"debug","name":"result","wires":[]}
    ],
    "configs": []
  }'
# -> {"id":"a6d46e9613768438"}
# server "fmserver1" = the predefined fm-server node; else include it in configs.`;

const NR_UPDATE = String.raw`# Update one flow (replace its tab)
curl -X PUT https://<host>/node-red/red/flow/<flowId> \
  ${NR_AUTH} ${JSON_H} \
  -d '{"id":"<flowId>","label":"Toggle switch (10s)",
       "nodes":[ ...updated nodes... ],"configs":[]}'`;

const NR_DELETE = String.raw`curl -X DELETE https://<host>/node-red/red/flow/<flowId> ${NR_AUTH}`;

const NR_REPLACE = String.raw`# Replace ALL flows at once (full deploy)
curl -X POST https://<host>/node-red/red/flows \
  ${NR_AUTH} ${JSON_H} \
  -H "Node-RED-Deployment-Type: full" \
  -d '[ {"id":"tab1","type":"tab","label":"Main"}, ...nodes and configs... ]'`;

const GF_CREATE = String.raw`# Create OR update (same call; overwrite:true updates by uid/title)
curl -X POST https://<host>/grafana/api/dashboards/db ${JSON_H} \
  -d '{
    "dashboard": {
      "title": "Fleet Energy",
      "schemaVersion": 39,
      "panels": [
        {"type":"timeseries","title":"Energy by device (kWh)",
         "datasource":{"type":"grafana-postgresql-datasource","uid":"<fm-ds-uid>"},
         "targets":[{"format":"time_series","rawSql":"SELECT $__timeGroupAlias(bucket,$__interval), device, SUM(sum_val)/1000.0 FROM device_em.energy_15min WHERE tag='\''total_act_energy'\'' AND $__timeFilter(bucket) GROUP BY 1,2"}]}
      ]
    },
    "overwrite": true
  }'
# -> {"uid":"...","url":"/grafana/d/.../fleet-energy","status":"success"}
# Query the curated views (device_em.energy_15min, mv__* aggregates), not raw tables.`;

const GF_GET = String.raw`curl https://<host>/grafana/api/dashboards/uid/<uid>`;

const GF_LIST = String.raw`curl "https://<host>/grafana/api/search?type=dash-db"`;

const GF_DELETE = String.raw`curl -X DELETE https://<host>/grafana/api/dashboards/uid/<uid>`;

const GF_DS = String.raw`curl https://<host>/grafana/api/datasources/name/fm`;

export function generate(): EmbeddedApp[] {
    return [
        {
            app: 'Node-RED',
            feature: 'node-red',
            proxyBase: '/node-red/red',
            authExternal:
                'FM session or Bearer PAT with node-red access; FM injects x-fm-node-red-proxy-secret upstream',
            authInternal:
                'Direct to node-red:1880 with header x-fm-node-red-proxy-secret',
            endpoints: [
                {
                    method: 'GET',
                    path: '/node-red/red/flows',
                    purpose: 'List all flows (+ rev)',
                    example: NR_LIST
                },
                {
                    method: 'POST',
                    path: '/node-red/red/flow',
                    purpose: 'Create one flow (tab) -> {id}',
                    example: NR_CREATE
                },
                {
                    method: 'PUT',
                    path: '/node-red/red/flow/:id',
                    purpose: 'Update one flow',
                    example: NR_UPDATE
                },
                {
                    method: 'DELETE',
                    path: '/node-red/red/flow/:id',
                    purpose: 'Delete one flow',
                    example: NR_DELETE
                },
                {
                    method: 'POST',
                    path: '/node-red/red/flows',
                    purpose: 'Replace all flows (full deploy)',
                    example: NR_REPLACE
                }
            ]
        },
        {
            app: 'Grafana',
            feature: 'grafana',
            proxyBase: '/grafana/api',
            authExternal:
                'FM session with grafana access; FM injects X-WEBAUTH-USER upstream',
            authInternal: 'Direct to grafana:3000 with header X-WEBAUTH-USER',
            endpoints: [
                {
                    method: 'POST',
                    path: '/grafana/api/dashboards/db',
                    purpose: 'Create or update a dashboard -> {uid,url}',
                    example: GF_CREATE
                },
                {
                    method: 'GET',
                    path: '/grafana/api/dashboards/uid/:uid',
                    purpose: 'Get a dashboard by uid',
                    example: GF_GET
                },
                {
                    method: 'GET',
                    path: '/grafana/api/search',
                    purpose: 'List dashboards and folders',
                    example: GF_LIST
                },
                {
                    method: 'DELETE',
                    path: '/grafana/api/dashboards/uid/:uid',
                    purpose: 'Delete a dashboard',
                    example: GF_DELETE
                },
                {
                    method: 'GET',
                    path: '/grafana/api/datasources/name/fm',
                    purpose: 'The provisioned read-only fm datasource',
                    example: GF_DS
                }
            ]
        }
    ];
}

export function renderMarkdown(apps: EmbeddedApp[]): string {
    const lines: string[] = [
        '# Embedded Apps API (Node-RED + Grafana)',
        '',
        'Generated by `backend/scripts/generate/` — do not edit by hand.',
        'Regenerate with `cd backend && npm run generate`.',
        '',
        "These are the upstream tools' own APIs, reached through FM's",
        'authenticated proxy. Build the payload, POST it through the proxy; the',
        "embedded tool then calls FM's `/rpc` (Node-RED) or the read-only `fm`",
        'datasource (Grafana). The live `/api/docs/embedded-apps` endpoint lists',
        'only the add-ons the running deployment has enabled.',
        ''
    ];
    for (const a of apps) {
        lines.push(`## ${a.app}`);
        lines.push('');
        lines.push(`- Proxy base: \`${a.proxyBase}\``);
        lines.push(`- Auth (external): ${a.authExternal}`);
        lines.push(`- Auth (internal): ${a.authInternal}`);
        lines.push('');
        for (const e of a.endpoints) {
            lines.push(`### \`${e.method} ${e.path}\``);
            lines.push('');
            lines.push(e.purpose);
            lines.push('');
            lines.push('```bash');
            lines.push(e.example);
            lines.push('```');
            lines.push('');
        }
    }
    return lines.join('\n');
}
