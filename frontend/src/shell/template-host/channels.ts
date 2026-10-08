// A thin alias over one namespace. The curated shape lives at
// `fleet.notifications.channels`; this name stays a direct proxy because it
// maps to exactly one namespace, and the generated SDK index maps modules to
// namespaces. Binding the sub-object instead would make this module report the
// whole notification surface, which is not what it reaches.

import {createHostDomain} from './domain';

export const channels = createHostDomain('channel');
