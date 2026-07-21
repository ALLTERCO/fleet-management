/**
 * Public API types for the `user.*` namespace — auth (Zitadel + Alexa),
 * user CRUD, PAT management, and permission editing.
 */

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {SCOPE_SCHEMA} from './assignment';
import {AUTHZ_SYSTEM_PERSONA_KEYS} from './authzCatalog';
import {
    UPLOAD_TICKET_RESPONSE_SCHEMA,
    USERNAME_UPLOAD_TICKET_PARAMS_SCHEMA
} from './upload';

const STR: JsonSchema = {type: 'string'};
const STR_REQ: JsonSchema = {type: 'string', minLength: 1};
const INT_ID: JsonSchema = {type: 'integer', minimum: 1};
const ACK: JsonSchema = {type: 'object', additionalProperties: true};

// Named response shapes — OWASP API3:2023 declares fields explicitly so
// clients can't silently consume undocumented extras and validators flag
// drift between contract and implementation.
const GET_ME_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'roles',
        'group',
        'canWrite',
        'isAdmin',
        'isPlatformAdmin',
        'isViewer',
        'effectiveShape',
        'uiCapabilities'
    ],
    properties: {
        roles: {type: 'array', items: STR},
        group: {type: ['string', 'null']},
        canWrite: {type: 'boolean'},
        isAdmin: {type: 'boolean'},
        isPlatformAdmin: {type: 'boolean'},
        isViewer: {type: 'boolean'},
        effectiveShape: {type: 'object', additionalProperties: true},
        uiCapabilities: {type: 'object', additionalProperties: true}
    }
};
const CREATE_PAT_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['tokenId', 'token', 'expirationDate'],
    additionalProperties: false,
    properties: {
        tokenId: STR_REQ,
        token: STR_REQ,
        // Zitadel returns null when expirationDays was omitted (no expiry).
        expirationDate: {type: ['string', 'null']}
    }
};
const REVOKED_COUNT_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['revokedCount'],
    additionalProperties: false,
    properties: {revokedCount: {type: 'integer', minimum: 0}}
};
const ZITADEL_AVAILABLE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['available'],
    additionalProperties: false,
    properties: {available: {type: 'boolean'}}
};
const EFFECTIVE_PERMISSIONS_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'userId',
        'tenantId',
        'shape',
        'provenance',
        'hasCredentialBoundary',
        'noAccessReason'
    ],
    properties: {
        userId: STR_REQ,
        tenantId: STR_REQ,
        shape: {type: 'object', additionalProperties: true},
        provenance: {type: 'object', additionalProperties: true},
        hasCredentialBoundary: {type: 'boolean'},
        noAccessReason: {type: ['string', 'null']}
    }
};
const SUCCESS_ACK: JsonSchema = {
    type: 'object',
    required: ['success'],
    additionalProperties: false,
    properties: {success: {type: 'boolean'}}
};
const OK_ACK: JsonSchema = {
    type: 'object',
    required: ['ok'],
    additionalProperties: false,
    properties: {ok: {type: 'boolean'}}
};
const USER_ID_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {userId: STR_REQ}
};
const SCOPED_PAT_TOKEN_RESPONSE: JsonSchema = {
    // CreateScopedPAT + RotateScopedPAT share this shape. expirationDate is
    // ISO; nullable to match cases where no expiry was set.
    type: 'object',
    required: ['tokenId', 'token', 'expirationDate'],
    additionalProperties: false,
    properties: {
        tokenId: STR_REQ,
        token: STR_REQ,
        expirationDate: {type: ['string', 'null']}
    }
};
const _ROTATE_ZITADEL_PAT_RESPONSE: JsonSchema = {
    // RotatePAT (Zitadel) returns the fresh token plus the displaced one +
    // the grace window so callers can confirm dual-validity windows.
    type: 'object',
    required: [
        'tokenId',
        'token',
        'expirationDate',
        'replacedTokenId',
        'graceMs'
    ],
    additionalProperties: false,
    properties: {
        tokenId: STR_REQ,
        token: STR_REQ,
        expirationDate: {type: ['string', 'null']},
        replacedTokenId: STR_REQ,
        graceMs: {type: 'integer', minimum: 0}
    }
};
const ASSIGN_PERSONA_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['success', 'assignmentId'],
    additionalProperties: false,
    properties: {
        success: {type: 'boolean'},
        assignmentId: STR_REQ
    }
};
const ALLOW_DEBUG_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['allowDebugUser'],
    additionalProperties: false,
    properties: {allowDebugUser: {type: 'boolean'}}
};
const ALEXA_REFRESH_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['access_token'],
    additionalProperties: false,
    properties: {access_token: STR_REQ}
};
const SERVICE_USER_CREATE_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['userId', 'userName', 'role', 'principal', 'accessPreview'],
    properties: {
        userId: STR_REQ,
        userName: STR_REQ,
        role: {type: ['string', 'null']},
        principal: {type: 'object', additionalProperties: true},
        accessPreview: {type: 'object', additionalProperties: true}
    }
};
const LIST_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['items', 'total', 'limit', 'offset', 'has_more'],
    properties: {
        items: {
            type: 'array',
            items: {type: 'object', additionalProperties: true}
        },
        total: {type: 'integer'},
        limit: {type: 'integer'},
        offset: {type: 'integer'},
        has_more: {type: 'boolean'}
    }
};
const SCOPED_PAT_PREVIEW_RESPONSE: JsonSchema = {
    type: 'object',
    required: [
        'usable',
        'effectiveStatementCount',
        'noAccessReason',
        'effectiveShape'
    ],
    properties: {
        usable: {type: 'boolean'},
        effectiveStatementCount: {type: 'integer', minimum: 0},
        noAccessReason: {type: ['string', 'null']},
        effectiveShape: {type: 'object', additionalProperties: true}
    },
    additionalProperties: false
};

const AUTH_PARAMS: JsonSchema = {
    type: 'object',
    required: ['username', 'password'],
    properties: {username: STR_REQ, password: STR_REQ}
};
const AUTH_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['access_token'],
    properties: {
        access_token: STR,
        refresh_token: STR,
        expires_in: {type: 'integer'}
    }
};

const _ID_PARAM: JsonSchema = {
    type: 'object',
    required: ['id'],
    properties: {id: INT_ID}
};

const USERNAME_PARAM: JsonSchema = {
    type: 'object',
    required: ['username'],
    properties: {username: STR_REQ}
};
const PROFILE_PICTURE_URL_RESPONSE: JsonSchema = {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: {url: STR_REQ}
};

export const USER_DESCRIBE: DescribeOutput = new DescribeBuilder('user', {
    kind: 'fleet-manager',
    description:
        'Manage fleet-manager users, authentication, PATs, and permissions.'
})
    .registerMethod('SetAllowDebug', {
        safety: {operation: 'update'},
        params: {
            type: 'object',
            required: ['enabled'],
            properties: {enabled: {type: 'boolean'}}
        },
        response: ALLOW_DEBUG_RESPONSE,
        permission: {note: 'admin-only'},
        description: 'Toggle the allowDebugUser config flag.'
    })
    .registerMethod('AuthenticateAlexa', {
        params: {
            type: 'object',
            required: ['username', 'endpoint'],
            properties: {username: STR_REQ, endpoint: STR_REQ}
        },
        response: AUTH_RESPONSE,
        permission: {note: 'public — used by Alexa OAuth2 flow'},
        description:
            'Authenticate for Alexa OAuth2 — username must match caller.'
    })
    .registerMethod('RefreshAlexa', {
        params: {
            type: 'object',
            required: ['refresh_token'],
            properties: {refresh_token: STR_REQ}
        },
        response: ALEXA_REFRESH_RESPONSE,
        permission: {note: 'public — token-bound'},
        description: 'Refresh the Alexa access token.'
    })
    .registerMethod('Authenticate', {
        params: AUTH_PARAMS,
        response: AUTH_RESPONSE,
        permission: {note: 'public'},
        description: 'Login with username + password (dev-mode / non-Zitadel).'
    })
    .registerMethod('RotateToken', {
        safety: {operation: 'update'},
        params: {
            type: 'object',
            required: ['access_token'],
            properties: {access_token: STR_REQ}
        },
        response: OK_ACK,
        permission: {note: 'public — caller must already hold a valid WS'},
        description:
            'Swap the WS bearer after an OIDC silent renew. Pinned to the same user + tenant.'
    })
    .registerMethod('Refresh', {
        params: {
            type: 'object',
            required: ['refresh_token'],
            properties: {refresh_token: STR_REQ}
        },
        response: AUTH_RESPONSE,
        permission: {note: 'public — token-bound'},
        description: 'Refresh the access token.'
    })
    .registerMethod('GetMe', {
        safety: {operation: 'read'},
        params: {type: 'object', properties: {}},
        response: GET_ME_RESPONSE,
        permission: {note: 'authenticated'},
        description: 'Return the current user profile + permissions.'
    })
    .registerMethod('ProfilePicture.CreateUploadTicket', {
        safety: {operation: 'create'},
        params: USERNAME_UPLOAD_TICKET_PARAMS_SCHEMA,
        response: UPLOAD_TICKET_RESPONSE_SCHEMA,
        permission: {note: 'self or provider-support admin'},
        description:
            'Mint a short-lived ticket for POST /media/uploadProfilePic.'
    })
    .registerMethod('ProfilePicture.GetUrl', {
        safety: {operation: 'read'},
        params: USERNAME_UPLOAD_TICKET_PARAMS_SCHEMA,
        response: PROFILE_PICTURE_URL_RESPONSE,
        permission: {note: 'authenticated'},
        description: 'Mint a short-lived profile picture URL.'
    })
    .registerMethod('ProfilePicture.Remove', {
        safety: {operation: 'delete'},
        params: USERNAME_UPLOAD_TICKET_PARAMS_SCHEMA,
        response: {
            type: 'object',
            additionalProperties: false,
            required: ['removed'],
            properties: {removed: {type: 'boolean'}}
        },
        permission: {note: 'self or provider-support admin'},
        description:
            "Delete the user's uploaded profile picture. Subsequent GetUrl calls fall back to the default avatar."
    })
    .registerMethod('ZitadelAvailable', {
        safety: {operation: 'read'},
        params: {type: 'object', properties: {}},
        response: ZITADEL_AVAILABLE_RESPONSE,
        permission: {note: 'public'},
        description: 'Report whether Zitadel integration is configured.'
    })
    .registerMethod('ListZitadelUsers', {
        safety: {operation: 'read'},
        params: {type: 'object', properties: {}},
        response: LIST_RESPONSE,
        permission: {note: 'admin-only'},
        description: 'List users known to Zitadel for this organization.'
    })
    .registerMethod('GetEffectivePermissionsV2', {
        safety: {operation: 'read'},
        params: {
            type: 'object',
            required: ['userId'],
            properties: {userId: STR_REQ}
        },
        response: EFFECTIVE_PERMISSIONS_RESPONSE,
        permission: {note: 'admin or self'},
        description:
            'Return the resolved effective shape from the new authz resolver — built-in roles + group + direct assignments unioned, with provenance.'
    })
    .registerMethod('SimulateV2', {
        safety: {operation: 'read'},
        params: {
            type: 'object',
            required: ['userId', 'action', 'resourceType'],
            properties: {
                userId: STR_REQ,
                action: STR_REQ,
                resourceType: STR_REQ,
                resourceId: {type: ['string', 'integer']},
                builtInRoles: {type: 'array', items: STR}
            }
        },
        // Decision + matchedBy + provenance — shape is resolver-internal.
        // Keep open until the resolver result type stabilises.
        response: ACK,
        permission: {note: 'admin-only'},
        description:
            'Simulate an authz decision for a user via the new resolver. Returns decision + matchedBy provenance.'
    })
    .registerMethod('AttachCustomPersona', {
        safety: {operation: 'create'},
        params: {
            type: 'object',
            required: ['userId', 'personaId', 'scope'],
            properties: {
                userId: STR_REQ,
                personaId: STR_REQ,
                scope: {type: 'object', additionalProperties: true},
                reason: {
                    type: ['string', 'null'],
                    minLength: 1,
                    maxLength: 200
                },
                comment: {
                    type: ['string', 'null'],
                    minLength: 1,
                    maxLength: 1000
                },
                expiresAt: {type: ['string', 'null'], format: 'date-time'}
            }
        },
        response: ASSIGN_PERSONA_RESPONSE,
        permission: {note: 'admin-only'},
        description: 'Attach a custom FM persona to a user with scope.'
    })
    .registerMethod('CreateZitadelUser', {
        safety: {operation: 'create'},
        params: {type: 'object', additionalProperties: true},
        response: USER_ID_RESPONSE,
        permission: {note: 'admin-only'},
        description: 'Provision a Zitadel user.'
    })
    .registerMethod('UpdateZitadelUser', {
        safety: {operation: 'update'},
        params: {type: 'object', additionalProperties: true},
        response: SUCCESS_ACK,
        permission: {note: 'admin-only'},
        description: 'Update a Zitadel user.'
    })
    .registerMethod('SendPasswordReset', {
        safety: {operation: 'execute'},
        params: USERNAME_PARAM,
        response: SUCCESS_ACK,
        permission: {note: 'admin-only'},
        description: 'Trigger a Zitadel password-reset email for the user.'
    })
    .registerMethod('DeactivateUser', {
        safety: {operation: 'update'},
        params: USERNAME_PARAM,
        response: SUCCESS_ACK,
        permission: {note: 'admin-only'},
        description: 'Deactivate a user in Zitadel.'
    })
    .registerMethod('ReactivateUser', {
        safety: {operation: 'update'},
        params: USERNAME_PARAM,
        response: SUCCESS_ACK,
        permission: {note: 'admin-only'},
        description: 'Reactivate a previously deactivated Zitadel user.'
    })
    .registerMethod('DeleteZitadelUser', {
        safety: {operation: 'delete'},
        params: USERNAME_PARAM,
        response: SUCCESS_ACK,
        permission: {note: 'admin-only'},
        description:
            'Hard-delete a Zitadel user. Irreversible; audit_log retains the historical record. Use DeactivateUser for soft delete.'
    })
    .registerMethod('ListServiceUsers', {
        safety: {operation: 'read'},
        params: {type: 'object', properties: {}},
        response: LIST_RESPONSE,
        permission: {note: 'admin-only'},
        description:
            'List Zitadel service users (machine accounts). Tenant-scoped admins see own org; global provider support sees all.'
    })
    .registerMethod('CreateServiceUser', {
        safety: {operation: 'create'},
        params: {
            type: 'object',
            required: ['userName', 'name'],
            additionalProperties: false,
            properties: {
                userName: STR_REQ,
                name: STR_REQ,
                description: STR,
                role: {
                    type: 'string',
                    enum: [...AUTHZ_SYSTEM_PERSONA_KEYS]
                },
                groupIds: {
                    type: 'array',
                    items: {type: 'string', format: 'uuid'}
                },
                assignments: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['personaId', 'scope'],
                        additionalProperties: false,
                        properties: {
                            personaId: {type: 'string', format: 'uuid'},
                            scope: SCOPE_SCHEMA,
                            reason: {
                                type: ['string', 'null'],
                                minLength: 1,
                                maxLength: 200
                            },
                            comment: {
                                type: ['string', 'null'],
                                minLength: 1,
                                maxLength: 1000
                            },
                            expiresAt: {
                                type: ['string', 'null'],
                                format: 'date-time'
                            }
                        }
                    }
                }
            }
        },
        response: SERVICE_USER_CREATE_RESPONSE,
        permission: {note: 'admin-only'},
        description:
            'Create a Zitadel service user. Role is optional; users without a role or FM assignment have no FM access.'
    })
    .registerMethod('DeleteServiceUser', {
        safety: {operation: 'delete'},
        params: USERNAME_PARAM,
        response: SUCCESS_ACK,
        permission: {note: 'admin-only'},
        description:
            'Hard-delete a Zitadel service user. Irreversible; tenant gate ensures only the home-org admin can delete.'
    })
    .registerMethod('CreatePAT', {
        safety: {operation: 'create'},
        params: {
            type: 'object',
            required: ['userId'],
            properties: {
                userId: STR_REQ,
                expirationDays: {type: 'integer', minimum: 1}
            }
        },
        response: CREATE_PAT_RESPONSE,
        permission: {note: 'admin-only'},
        description: 'Create a Personal Access Token for a user/service user.'
    })
    .registerMethod('ListPATs', {
        safety: {operation: 'read'},
        params: {
            type: 'object',
            required: ['userId'],
            properties: {userId: STR_REQ}
        },
        response: LIST_RESPONSE,
        permission: {note: 'admin-only'},
        description: 'List Personal Access Tokens for a user.'
    })
    .registerMethod('RevokePAT', {
        safety: {operation: 'delete'},
        params: {
            type: 'object',
            required: ['userId', 'tokenId'],
            properties: {userId: STR_REQ, tokenId: STR_REQ}
        },
        response: SUCCESS_ACK,
        permission: {note: 'admin-only'},
        description: 'Revoke a Personal Access Token.'
    })
    .registerMethod('CreateScopedPAT', {
        safety: {operation: 'create'},
        params: {
            type: 'object',
            required: ['userId', 'boundaryScope', 'purpose'],
            additionalProperties: false,
            properties: {
                userId: STR_REQ,
                boundaryScope: SCOPE_SCHEMA,
                purpose: {type: 'string', minLength: 1, maxLength: 200},
                audience: {
                    type: 'array',
                    items: {type: 'string', minLength: 1}
                },
                expirationDays: {type: 'integer', minimum: 1, maximum: 365}
            }
        },
        response: SCOPED_PAT_TOKEN_RESPONSE,
        permission: {note: 'admin-only'},
        description:
            'Mint an FM-issued scoped PAT. boundaryScope narrows the user effective shape at the auth gate; can only subtract, never escalate.'
    })
    .registerMethod('ListScopedPATs', {
        safety: {operation: 'read'},
        params: {
            type: 'object',
            additionalProperties: false,
            properties: {userId: STR_REQ}
        },
        response: LIST_RESPONSE,
        permission: {note: 'admin-only'},
        description:
            'List FM-issued scoped PATs. Filter by userId when supplied; otherwise lists every scoped PAT in the caller tenant.'
    })
    .registerMethod('PreviewScopedPAT', {
        safety: {operation: 'read'},
        params: {
            type: 'object',
            required: ['userId', 'boundaryScope'],
            additionalProperties: false,
            properties: {
                userId: STR_REQ,
                boundaryScope: SCOPE_SCHEMA
            }
        },
        response: SCOPED_PAT_PREVIEW_RESPONSE,
        permission: {note: 'admin-only'},
        description:
            'Preview the effective access produced by applying a proposed FM scoped PAT boundary to the target principal.'
    })
    .registerMethod('RevokeScopedPAT', {
        safety: {operation: 'delete'},
        params: {
            type: 'object',
            required: ['tokenId'],
            additionalProperties: false,
            properties: {tokenId: {type: 'string', format: 'uuid'}}
        },
        response: SUCCESS_ACK,
        permission: {note: 'admin-only'},
        description: 'Revoke an FM-issued scoped PAT (soft delete).'
    })
    .registerMethod('RevokeAllUserPATs', {
        safety: {operation: 'delete'},
        params: {
            type: 'object',
            required: ['userId'],
            additionalProperties: false,
            properties: {userId: STR_REQ}
        },
        response: REVOKED_COUNT_RESPONSE,
        permission: {note: 'admin-only'},
        description:
            'Bulk-revoke every active FM-issued scoped PAT for a user. Off-boarding helper.'
    })
    .registerMethod('RotateScopedPAT', {
        safety: {operation: 'execute'},
        params: {
            type: 'object',
            required: ['tokenId'],
            additionalProperties: false,
            properties: {
                tokenId: {type: 'string', format: 'uuid'},
                expirationDays: {type: 'integer', minimum: 1, maximum: 365}
            }
        },
        response: SCOPED_PAT_TOKEN_RESPONSE,
        permission: {note: 'admin-only'},
        description:
            'Atomic rotate of an FM-issued scoped PAT: revoke the old + mint a new one carrying the same boundary/audience/purpose, in one transaction. Returns the new token once.'
    })
    .build();
