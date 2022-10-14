import express from 'express';
const router = express.Router();
import log4js from 'log4js';
const logger = log4js.getLogger();
import { Consumption } from "../../database";

router.post("/", async (req, res) => {
    const { device_mac, channel } = req.body;
    if (device_mac == undefined || channel == undefined) {
        res.sendStatus(400).end();
        return;
    }
    try {
        const consumption = await getConsumptionData(device_mac, channel);
        res.json(consumption);
    } catch (error) {
        res.json([]);
        logger.error("error in /consumption", error)
    }
})

async function getConsumptionData(shellyID: string, channel: number) {
    const allConsumption = await Consumption.findAll({
        where: { shellyID, channel },
        raw: true,
        attributes: ['timestamp', 'consumption']
    });

    const entries: Record<number, number> = {};
    for(const { timestamp, consumption} of allConsumption){
        entries[timestamp] = consumption;
    }

    const statEntries: Record<number, number> = {};

    const now = new Date(Date.now());
    now.setUTCHours(now.getUTCHours() + 1,0,0,0);
    for(let i = 0; i <= 24; i++){
        statEntries[now.getTime() / 1000] = 0;
        now.setUTCHours(now.getUTCHours() - 1); 
    }

    // aggregate
    for(const [key,val] of Object.entries(entries)){
        const statDate = new Date(Number(key) * 1000);
        statDate.setUTCHours(statDate.getUTCHours() + 1,0,0,0);
        const statKey = statDate.getTime() / 1000;
        if(statEntries[statKey] != undefined){
            // statEntries[statKey] = 0;
            statEntries[statKey] += val;
        }
    }

    return Object.entries(statEntries);
}

export default router;