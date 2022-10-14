import { Request, Response, NextFunction } from "express";
import { getLogger } from "log4js";
import * as globals from "../../globals";
const logger = getLogger("auth")

export default (req: Request, res: Response, next: NextFunction) => {
    if (['/', '/shelly', '/ble'].includes(req.path)
        || req.path.startsWith("/css")
        || req.path.startsWith("/js")
        || req.path.endsWith(".jpg")) {
        next();
        return
    }
    let auth = req.headers['authorization'] || req.query['auth'] as string;
    if (auth == undefined) {
        res.sendStatus(403).end();
        return;
    }
    if (auth.startsWith('Basic ')) {
        auth = auth.substring(6);
    }
    if (auth != globals.PASSWORD) {
        logger.warn("wrong auth provided", auth)
        res.sendStatus(403).end();
        return;
    }
    next();
}