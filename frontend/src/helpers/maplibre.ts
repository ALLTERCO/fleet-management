import {setWorkerUrl} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

let workerConfigured = false;

export function configureMapLibreWorker(): void {
    if (workerConfigured) return;
    setWorkerUrl(maplibreWorkerUrl);
    workerConfigured = true;
}
