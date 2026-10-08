// fm-target builds {deviceIds, groupIds, locationIds, tagKeys, fleet} on
// msg.fm.target; the next operation node copies it into a `target` param
// only when that param is made of these same fields.

const TARGET_FIELDS = new Set([
    'deviceIds',
    'groupIds',
    'locationIds',
    'tagKeys',
    'fleet'
]);

function csv(value) {
    return String(value || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
}

function integerCsv(value, label) {
    return csv(value).map((part) => {
        if (!/^-?\d+$/.test(part)) {
            throw new Error(`${label} must be comma-separated integers`);
        }
        const parsed = Number.parseInt(part, 10);
        if (!Number.isSafeInteger(parsed)) {
            throw new Error(`${label} contains an unsafe integer`);
        }
        return parsed;
    });
}

function targetFromConfig(config) {
    const target = {};
    const deviceIds = csv(config.deviceIds);
    const groupIds = integerCsv(config.groupIds, 'groupIds');
    const locationIds = csv(config.locationIds);
    const tagKeys = csv(config.tagKeys);
    if (deviceIds.length > 0) target.deviceIds = deviceIds;
    if (groupIds.length > 0) target.groupIds = groupIds;
    if (locationIds.length > 0) target.locationIds = locationIds;
    if (tagKeys.length > 0) target.tagKeys = tagKeys;
    if (config.fleet === true || config.fleet === 'true') target.fleet = true;
    return target;
}

function isFilled(value) {
    if (Array.isArray(value)) return value.length > 0;
    return (
        value !== false && value !== undefined && value !== null && value !== ''
    );
}

// Closed and built only from fm-target fields; {kind, id} or "any object"
// targets mean something else, so they are left to the user.
function takesFleetTarget(schema) {
    const fields = Object.keys(schema?.properties || {});
    return (
        schema?.additionalProperties === false &&
        fields.length > 0 &&
        fields.every((field) => TARGET_FIELDS.has(field))
    );
}

function filledFields(target) {
    return Object.keys(target).filter((field) => isFilled(target[field]));
}

// Dropping a field would quietly change which devices the call reaches.
function checkedTarget(target, schema) {
    const fields = filledFields(target);
    const refused = fields.filter(
        (field) => !Object.hasOwn(schema.properties, field)
    );
    if (refused.length > 0) {
        throw new Error(`this method cannot target ${refused.join(', ')}`);
    }
    return Object.fromEntries(fields.map((field) => [field, target[field]]));
}

function isTargetObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** request: {params, target, targetSchema} */
function paramsWithTarget(request) {
    const {params, target, targetSchema} = request;
    if (!isTargetObject(target) || Object.hasOwn(params, 'target'))
        return params;
    if (!takesFleetTarget(targetSchema)) return params;
    const checked = checkedTarget(target, targetSchema);
    if (Object.keys(checked).length === 0) return params;
    return {...params, target: checked};
}

module.exports = {
    csv,
    paramsWithTarget,
    targetFromConfig
};
