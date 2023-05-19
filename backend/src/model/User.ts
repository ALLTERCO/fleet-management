import * as components from "../config/components";
import log4js from 'log4js';
import { MAIN_CONFIG } from '../config';
import * as jwt from 'jsonwebtoken';

const logger = log4js.getLogger();
let USERS_CONFIG: Record<string, user_t> = components.getConfigFor("user", {});

export function refreshUserConfig() {
    USERS_CONFIG = components.getConfigFor("user", {});
}

export let allowDebug = false;

export const DEBUG_USER: user_t = {
    username: "DEBUG",
    password: "",
    permissions: ["*"],
    group: "admin",
    enabled: false
}

function signToken(username: string) {
    return jwt.sign({
        username,
    }, MAIN_CONFIG.jwt_token, {
        expiresIn: '1d',
        issuer: 'fleet-management',
        subject: 'general-login'
    })
}

export function login(username: string, password: string) {
    const user = USERS_CONFIG[username];
    if (user == undefined || user.password == undefined) {
        logger.warn("user not found username=[%s]", username);
        return undefined;
    }
    if (user.enabled !== true) {
        logger.warn("user disabled username=[%s]", username);
        return undefined;
    }

    if (user.password != password) {
        logger.warn("user wrong password username=[%s]", username);
        return undefined;
    }

    return signToken(username);
}

export function verifyToken(token: string | undefined) {
    try {
        if (token == undefined) {
            if (!allowDebug) {
                return undefined;
            }
            token = generateDebugToken();
        }
        if (!token.includes(".")) { // jwt has ".", basic auth does not
            const decoded = Buffer.from(token, 'base64').toString('utf-8');
            const [username = "", password = ""] = decoded.split(":");
            token = login(username, password) || "";
        }
        return jwt.verify(token, MAIN_CONFIG.jwt_token, {
            issuer: 'fleet-management',
            subject: 'general-login'
        }) as jwt.JwtPayload;
    } catch (error) {
        return undefined;
    }
}

export function getUserFromConfig(username: string) {
    if (username === 'DEBUG') {
        return allowDebug ? DEBUG_USER : undefined
    }

    return USERS_CONFIG[username];
}

export function getUserFromToken(token: string | undefined) {
    const decoded = verifyToken(token);
    if (decoded == undefined) return undefined;
    const user = getUserFromConfig(decoded.username);
    if (user == undefined) return undefined;
    return user;
}

export function generateDebugToken() {
    return signToken("DEBUG");
}

export function hasMountPermission(token: string | undefined, shellyID: string) {
    const user = getUserFromToken(token);
    if (user == undefined) {
        return false;
    }

    return user.permissions.includes("*")
        || user.permissions.includes("mount:*")
        || user.permissions.includes(`mount:${shellyID}`)
}

export function hasApiPermission(token: string | undefined, route: string) {
    const user = getUserFromToken(token);
    if (user == undefined) {
        return false;
    }

    return user.permissions.includes("*")
        || user.permissions.includes("api:*")
        || user.permissions.includes(`api:${route}`)
}

export function setAllowDebugging(value: boolean) {
    logger.warn("Enabling DEBUG user, this is only recommended in DEVELOPMENT environments!")
    allowDebug = value;
}