import express from 'express';
import log4js from 'log4js';
import {configRc} from '../../../config';

const logger = log4js.getLogger('grafana-proxy');
const router = express.Router();
const grafanaUrl = configRc.graphs?.grafana.endpoint;

async function* readChunks(reader: any) {
    let readResult = await reader.read();
    while (!readResult.done) {
        yield readResult.value;
        readResult = await reader.read();
    }
}

function getUrl(url: string) {
    const ms = '/grafana';
    if (!url.startsWith(ms)) {
        return `${grafanaUrl}${url}`;
    }
    return `${grafanaUrl}${url.slice(0, ms.length)}`;
}
router.all('/*', async (req, res) => {
    const fUrl = getUrl(req.url);
    let headers: any;
    let body: any;
    if (req.method === 'POST') {
        body = JSON.stringify(req.body);
        headers = Object.keys(req.headers).reduce((a: any, k) => {
            if (['connection', 'origin', 'referer', 'cookie'].indexOf(k) < 0) {
                a[k] = req.headers[k];
            }
            return a;
        }, {});
    }
    try {
        const rr = await fetch(fUrl, {method: req.method, headers, body});
        rr.headers.forEach((val, key) => {
            key.indexOf('frame') === -1 && res.appendHeader(key, val);
        });
        res.status(rr.status);
        const reader = rr.body?.getReader();
        if (reader) {
            try {
                for await (const chunk of readChunks(reader)) {
                    res.write(chunk);
                }
            } catch (e) {
                logger.error('Grafana stream read error: %s', e);
            }
            reader.releaseLock();
            res.end();
        }
    } catch (e) {
        logger.error('Grafana proxy error for %s: %s', fUrl, e);
        res.sendStatus(500);
        res.end();
    }
});

export default router;
