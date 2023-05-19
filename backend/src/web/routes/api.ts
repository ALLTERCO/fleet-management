import express from 'express';
const router = express.Router();
import * as DeviceManager from "../../DeviceManager";
import * as User from '../../model/User';

const SWITCH_COMMANDS = ['on', 'off', 'toggle']

router.use((req, res, next) => {
    if(!User.hasApiPermission(req.token, req.path)){
        res.status(403);
        return;
    }
    next();
})

router.get('/switch', (req, res) => {
    const { turn, shellyID, channel = 0} = req.query;
    if (typeof shellyID !== 'string' || typeof turn !== 'string') {
        res.status(400).json({ error: "missing shellyID or turn query" }).end();
        return;
    }

    if (!SWITCH_COMMANDS.includes(turn)) {
        res.status(400).json({ error: "cmd not found" }).end();
        return;
    }

    const shelly = DeviceManager.getDevice(shellyID);
    if (!shelly) {
        res.status(400).json({ error: "cannot find the specified shellyID" }).end();
        return;
    }
    const channelExists = shelly.status['switch:' + channel] != undefined;
    if (!channelExists) {
        res.status(400).json({ error: "cannot find the specified channel of the switch component" }).end();
        return;
    }
    switch (turn) {
        case 'on':
            shelly.shellyRPC('Switch.Set', { id: channel, on: true });
            break;
        case 'off':
            shelly.shellyRPC('Switch.Set', { id: channel, on: false });
            break;
        case 'toggle':
            shelly.shellyRPC('Switch.Toggle', { id: channel });
            break;
    }
    res.status(200).json({ msg: "command queued" });
})

export default router;