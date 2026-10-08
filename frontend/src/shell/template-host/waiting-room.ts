// Re-bound to the Fleet transport. The behaviour lives in the core domain;
// this file only names it. It used to be a second, untyped proxy over the
// same namespace, so the same call had two homes and one of them skipped
// every argument shape the curated one applies.

import {hostRpcAccess} from './api';
import {createWaitingRoomDomain} from './core/domains/waiting-room';

export const waitingRoom = createWaitingRoomDomain(hostRpcAccess);
