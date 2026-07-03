// Side-effecting shim — same role as test/_runtimeMetadataEnv.ts but for
// scripts run via `npx tsx backend/scripts/…`. Provides safe defaults for
// the env vars config/index.ts reads eagerly at module load so the bench
// can stay self-contained (no real deployment env required).

process.env.FM_API_CONTRACT_VERSION ??= '1';
process.env.FM_UI_CONTRACT_VERSION ??= '1';
process.env.FM_FRONTEND_ARTIFACT_ID ??= 'bench';
process.env.FM_FRONTEND_ARTIFACT_VERSION ??= '0.0.0';
process.env.FM_DEPLOYMENT_MODE ??= 'oss';
process.env.FM_SAFE_MODE ??= 'false';
