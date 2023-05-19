/// <reference types="vite/client" />

interface ImportMeta {
    readonly env: ImportMetaEnv
}

interface ImportMetaEnv {
    VITE_BACKEND_URI: string,
    VITE_FLEET_WS: string,
}