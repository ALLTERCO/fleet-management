import express from 'express';
const app = express();
import https from 'https';
import log4js from 'log4js';
const logger = log4js.getLogger("web");
import { HTTPS_CRT, HTTPS_KEY, WEB_PORT_HTTP, WEB_PORT_HTTPS } from '../globals';
import { History, Event } from "../database";
import handleUpgrade from '../controller/ws/handleUpgrade';
import cors from "cors";
import rpc from "./routes/rpc";
import consumption from "./routes/consumption";
import device from "./routes/device";
import * as path from 'path';
import os from "os";
import basicAuth from './middleware/basicAuth';

app.use([
    log4js.connectLogger(logger, {
        level: "auto",
        format: ":status :method :url",
        nolog: "/health",
    }),
    express.json(),
    cors(),
    basicAuth
]);

const RELATIVE_CLIENT_PATH = process.env['RELATIVE_CLIENT_PATH'] || "../../../frontend/dist";
const clientPath = path.join(__dirname, RELATIVE_CLIENT_PATH);

logger.info("client static path %s", clientPath);
app.use("/", express.static(clientPath));

app.use("/device", device);
app.use("/rpc", rpc);
app.use('/consumption', consumption);

app.post("/events", async (req, res) => {
    const { page = 1, perPage = 25, shellyID, method } = req.body;
    let where = {};
    if(shellyID != undefined && method != undefined){
        where = { shellyID, method}
    }
    const count = await Event.count();
    let events = await Event.findAll({
        where,
        offset: (page-1) * perPage,
        limit: perPage,
    });
    try {
        res.json({ events, count })
    } catch (error) {
        res.json([]);
        logger.error("error in /events", error)
    }
});

app.get("/history", async (req, res) => {
    try {
        const history = await History.findAll({
            limit: 100,
            raw: false
        })
        res.json(history);
    } catch (error) {
        res.json([]);
        logger.error("error in /history", error)
    }
})

app.get("/health", (req, res) => {
    res.json({
        online: true,
        loadavg: os.loadavg(),
        totalmem: os.totalmem(),
        freemem: os.freemem()
    })
})

if (WEB_PORT_HTTP > -1) {
    const serverHttp = app.listen(WEB_PORT_HTTP, () => {
        logger.info("web started on port:[%i]", WEB_PORT_HTTP);
    });
    handleUpgrade(serverHttp);
}

if (WEB_PORT_HTTPS > -1) {
    const serverHttps = https
        .createServer({
            key: HTTPS_KEY,
            cert: HTTPS_CRT
        }, app)
        .listen(WEB_PORT_HTTPS, () => {
            logger.info("secure web started on port:[%i]", WEB_PORT_HTTPS);
        });
    handleUpgrade(serverHttps);
}
