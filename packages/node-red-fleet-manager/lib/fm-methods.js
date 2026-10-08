// Every Fleet Manager method the package calls on its own, outside the method
// a user picks in a node. The service account's permissions must cover these.

const FM_METHODS = Object.freeze({
    listDevices: 'device.List',
    listGroups: 'group.List',
    listPlaces: 'location.List',
    placeAndChildren: 'location.Descendants',
    reportActivity: 'automation.ReportActivity',
    subscribe: 'System.Subscribe',
    unsubscribe: 'System.Unsubscribe'
});

module.exports = {FM_METHODS};
