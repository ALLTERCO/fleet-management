const SAVED_WIFI_VAR = 'fleet-management-wifi';
const PROPOSE_WS = 'fleet-management-propose-ws';

export function getSavedWifi() {
    try {
        return JSON.parse(localStorage.getItem(SAVED_WIFI_VAR) || '{}') as Record<string,string>;
    } catch (error) {
        return {}
    }
}

export function addSavedWifi(name: string, password: string) {
    localStorage.setItem(SAVED_WIFI_VAR, JSON.stringify({ ...getSavedWifi(), [name]: password }))
}

export function deleteSavedWifi(name: string){
    const saved = getSavedWifi();
    delete saved[name];
    localStorage.setItem(SAVED_WIFI_VAR, JSON.stringify(saved))
}

export function getProposedWs(){
    return localStorage.getItem(PROPOSE_WS) || `${window.location.protocol === 'http:' ? 'ws' : 'wss'}://${window.location.host}/shelly`;
}

export function saveProposedWs(url: string){
    localStorage.setItem(PROPOSE_WS, url)
}