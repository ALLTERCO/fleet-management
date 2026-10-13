// Minimal non-production metadata for the backend's existing test script.
// No network credentials or external services are needed for unit tests.
process.env.FM_API_CONTRACT_VERSION ??= 'test';
process.env.FM_UI_CONTRACT_VERSION ??= 'test';
process.env.FM_FRONTEND_ARTIFACT_ID ??= 'test';
process.env.FM_FRONTEND_ARTIFACT_VERSION ??= 'default';
process.env.FM_DEPLOYMENT_MODE ??= 'oss';
process.env.FM_SAFE_MODE ??= 'false';
