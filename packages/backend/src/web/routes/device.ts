import express from 'express';
const router = express.Router();
import log4js from 'log4js';
const logger = log4js.getLogger();
import * as rpc from '../../controller/rpc';
import { devices } from "../../globals";
import { History } from "../../database";
import BleTransport from '../../model/transport/BleTransport';

router.get("/list", (_, res) => {
    let printDevices: { [key: string]: any } = {};
    for (const device of Object.values(devices)) {
        const { shellyID, lastStatus, lastStatusTs, deviceInfo, source, channels, fields } = device;
        printDevices[device.shellyID] = { shellyID, lastStatus, lastStatusTs, deviceInfo, source, channels, fields };
    }
    res.json(printDevices);
})

router.get("/:shellyID", (req, res) => {
    const { shellyID } = req.params;

    if (shellyID == undefined) {
        res.sendStatus(400).end();
        return;
    }

    res.json(devices[shellyID]);
})

router.post("/:shellyID/rpc", async (req, res) => {
    const { method, params } = req.body;
    const { shellyID } = req.params;

    if(method == undefined || shellyID == undefined){
        res.sendStatus(400).end();
        return;
    }
    try {
        const response = await rpc.call(shellyID, method, params); 
        res.json(response);
    } catch (error) {
        logger.warn("rpc call failed", error)
        res.status(400).json({
            isok:false,
            error: JSON.stringify(error)
        }).end();
    }
})

router.get("/:shellyID/history", async (req, res) => {
    const { shellyID } = req.params;
    if (shellyID == undefined) {
        res.sendStatus(400).end();
        return;
    }

    const history = await History.findAll({
        where: { shellyID },
        limit: 100,
        raw: true
    });

    try {
        res.json(history)
    } catch (error) {
        res.json([]);
        logger.error("error in /history/:shellyID", error)

    }
})

router.post("/:shellyID/provision", (req, res) => {
    const { shellyID } = req.params;
    if (shellyID == undefined) {
        res.sendStatus(400).end();
        return;
    }
    const device = devices[shellyID];
    if(device == undefined) {
        res.sendStatus(404).end();
        return;
    }

    const { wifi, wsServer } = req.body;
    console.log({ wifi, wsServer })
    if([wifi, wsServer].includes(undefined)){
        res.status(400).end();
        return;
    }

    if(!(device.transport instanceof BleTransport)){
        res.status(400).end();
        return;
    }

    device.transport.send(JSON.stringify({
        method: 'provision',
        mac: device.transport.mac,
        params: {wifi, wsServer} 
    }));

    res.status(200).end();
})

export default router;