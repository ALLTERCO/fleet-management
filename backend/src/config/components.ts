import path from "path";
import { CFG_FOLDER } from ".";
import * as fs from "fs";

const COMPONENT_CONFIG_FOLDER = path.join(CFG_FOLDER, "components");

function getCfgPath(component: string){
    return path.join(path.join(COMPONENT_CONFIG_FOLDER, encodeURIComponent(component) + '.json'));
}

export function getConfigFor(component: string, defaultConfig: Record<string, any>){
    const cfgPath = getCfgPath(component);
    if(fs.existsSync(cfgPath)){
        return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) || {}
    }
    return defaultConfig;
}

export function saveConfig(component: string, config: any){
    const cfgPath = getCfgPath(component);
    fs.writeFileSync(cfgPath, JSON.stringify(config, undefined, 4));
}