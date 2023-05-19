import express from 'express';
const app = express();
import https from 'https';
import log4js from 'log4js';
const logger = log4js.getLogger("web");
import { MAIN_CONFIG, DEVICES_CONFIG } from '../config';
import handleUpgrade from '../controller/ws/handleUpgrade';
import cors from "cors";
import auth from "./routes/auth";
import api from "./routes/api";
import * as path from 'path';
import * as User from "../model/User";
import * as QuickTokens from "../controller/QuickTokens";
import Commander from '../model/Commander';
import * as jsonrpc from '../tools/jsonrpc';

app.use([
    log4js.connectLogger(logger, {
        level: "auto",
        format: ":status :method :url",
        nolog: "/health",
    }),
    express.json(),
    cors(),
]);

const RELATIVE_CLIENT_PATH = process.env['RELATIVE_CLIENT_PATH'] || "../../../frontend/dist";
const clientPath = path.join(__dirname, RELATIVE_CLIENT_PATH);

logger.info("client static path %s", clientPath);
app.use("/", express.static(clientPath));

const EMBEDDED_WEB_PATH = path.join(__dirname, "../../embedded_web")
logger.info("EMBEDDED_WEB_PATH:[%s]", EMBEDDED_WEB_PATH)

for (const dev of DEVICES_CONFIG.embedded) {
    app.use(`/embedded/${dev}/`, express.static(path.join(EMBEDDED_WEB_PATH, dev)))
}
logger.info("registering embedded handler for apps:[%s]", DEVICES_CONFIG.embedded.join(","))

// Middleware

// assign token in req object
app.use((req, res, next) => {
    if (typeof req.headers['authorization'] === 'string') {
        const token = req.headers['authorization'].split(" ").at(-1)!;
        req.token = token;
        req.user = User.getUserFromToken(token);
    }

    next();
});

function isLoggedIn(req: express.Request, res: express.Response, next: express.NextFunction){
    if(req.token == undefined){
        res.status(401).end();
        return;
    }

    if(req.user == undefined){
        res.status(403).end();
        return;
    }

    next();
}

app.use("/auth", auth);
app.use('/api', api);

app.get<{ shellyID: string }>('/request-access/:shellyID', (req, res) => {
    const shellyID = req.params.shellyID;

    if (typeof shellyID !== 'string' || shellyID.length == 0) {
        res.status(400);
        return;
    }

    if (!User.hasMountPermission(req.token, shellyID)) {
        res.status(403).end();
        return;
    }

    const quickToken = QuickTokens.generateToken(`${shellyID}.mount`);
    res.cookie('fleet-manager-quick-token', quickToken, {
        httpOnly: true,
        maxAge: 60 * 60
    });
    res.status(204).end();
})

app.get<{ method: string }>("/rpc/:method", (req, res) => {
    const method = req.params.method;
    const query = req.query;

    // GET requests are only allowed while debugging
    if(!User.allowDebug){
        res.status(404).end();
        return;
    }

    Commander.getInstance().exec(User.DEBUG_USER, method, query).then((reps) => {
        res.status(200).json(reps).end();
    }, (err) => {
        const error_code = err.error_code || jsonrpc.ERROR_CODES.SERVER_ERROR;
        res.status(400).json(jsonrpc.buildOutgoingJsonRpcError(error_code, null)).end()
    });
})

app.post<{ method: string}>("/rpc/:method", isLoggedIn, (req, res) => {
    const user = req.user!;
    const method = req.params.method;
    const query = req.query;

    Commander.getInstance().exec(user, method, query).then((reps) => {
        res.status(200).json(reps).end();
    }, (err) => {
        const error_code = err.error_code || jsonrpc.ERROR_CODES.SERVER_ERROR;
        res.status(400).json(jsonrpc.buildOutgoingJsonRpcError(error_code, null)).end()
    });

})

app.get("/health", (req, res) => {
    res.json({
        online: true
    })
})

if (MAIN_CONFIG.port > -1) {
    const serverHttp = app.listen(MAIN_CONFIG.port, () => {
        logger.info("web started on port:[%i]", MAIN_CONFIG.port);
    });
    handleUpgrade(serverHttp);
}

if (MAIN_CONFIG.port_ssl > -1) {
    const serverHttps = https
        .createServer({
            key: MAIN_CONFIG.https_key,
            cert: MAIN_CONFIG.https_crt
        }, app)
        .listen(MAIN_CONFIG.port_ssl, () => {
            logger.info("secure web started on port:[%i]", MAIN_CONFIG.port_ssl);
        });
    handleUpgrade(serverHttps);
}
