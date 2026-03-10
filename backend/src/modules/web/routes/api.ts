import express from 'express';
import log4js from 'log4js';
import {DEV_MODE} from '../../../config';
import * as DeviceCollector from '../../../modules/DeviceCollector';
import {hasApiPermission} from '../../user';

const logger = log4js.getLogger('api');
const router = express.Router();

const SWITCH_COMMANDS = ['on', 'off', 'toggle'];

router.use(async (req, res, next) => {
    if (['/variables'].includes(req.url)) {
        return next();
    }
    if (!(await hasApiPermission(req.token, req.path))) {
        logger.warn('API permission denied: %s %s', req.method, req.path);
        res.status(403);
        return;
    }
    next();
});

router.get('/switch', (req, res) => {
    const {turn, shellyID, channel = 0} = req.query;
    if (typeof shellyID !== 'string' || typeof turn !== 'string') {
        res.status(400).json({error: 'missing shellyID or turn query'}).end();
        return;
    }

    if (!SWITCH_COMMANDS.includes(turn)) {
        res.status(400).json({error: 'cmd not found'}).end();
        return;
    }

    const shelly = DeviceCollector.getDevice(shellyID);
    if (!shelly) {
        res.status(400)
            .json({error: 'cannot find the specified shellyID'})
            .end();
        return;
    }
    const channelExists = shelly.status[`switch:${channel}`] !== undefined;
    if (!channelExists) {
        res.status(400)
            .json({
                error: 'cannot find the specified channel of the switch component'
            })
            .end();
        return;
    }
    switch (turn) {
        case 'on':
            shelly.sendRPC('Switch.Set', {id: channel, on: true});
            break;
        case 'off':
            shelly.sendRPC('Switch.Set', {id: channel, on: false});
            break;
        case 'toggle':
            shelly.sendRPC('Switch.Toggle', {id: channel});
            break;
    }
    res.status(200).json({msg: 'command queued'});
});

router.get('/variables', (req, res) => {
    res.status(200)
        .json({
            'login-strategy': DEV_MODE ? 'local' : 'zitadel-introspection',
            'dev-mode': DEV_MODE
        })
        .end();
});

export default router;
