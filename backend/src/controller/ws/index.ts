import WebSocket from "ws";
import log4js from 'log4js';
const logger = log4js.getLogger('ws');
import * as DeviceManager from "../../DeviceManager";
import { ERROR_CODES, parseIncomingJsonRpc, buildOutgoingJsonRpcError, buildOutgoingJsonRpc, incoming_jsonrpc as incoming_jsonrpc } from "../../tools/jsonrpc"
import Commander from "../../model/Commander";
import { getUserFromToken } from "../../model/User";

const PATH = "/";
export const wss = new WebSocket.Server({ noServer: true });

wss.on('listening', () => {
    logger.info("started on path:[%s]", PATH);
});

wss.on('connection', (socket, request) => {
    logger.info("connection on path:[%s]", PATH);

    const token = String(request.headers['token']);
    const user = getUserFromToken(token);

    if(user == undefined){
        socket.close(4403);
        return;
    }

    socket.on('message', (data) => {
        try {
            data = JSON.parse(data.toString());
        } catch (error) {
            logger.warn("error json parsing ws data", String(error));
            socket.send(JSON.stringify(
                buildOutgoingJsonRpcError(ERROR_CODES.PARSE_ERROR, null)
            ));
            return;
        }
        const parsed: any = data; // make immutable
        if (typeof parsed === 'object' && Array.isArray(parsed)) {
            for (const single of parsed) {
                handleIncomingMessage(socket, single, user);
            }
            return;
        }
        handleIncomingMessage(socket, parsed, user);
    });
});

wss.on('close', () => {
    logger.info("closed connection on path:[%s]", PATH);
});

wss.on('error', () => {
    logger.info("closed error on path:[%s]", PATH);
})

function singleRelayCommand(socket: WebSocket.WebSocket, shellyID: string, data: incoming_jsonrpc) {
    const shelly = DeviceManager.getDevice(shellyID);
    if (shelly == undefined) {
        socket.send(JSON.stringify(
            buildOutgoingJsonRpcError(ERROR_CODES.INVALID_REQUEST, data.id, undefined, "No such device")
        ));
        return;
    }
    shelly.shellyRPC(data.method, data.params, (resp) => {
        resp.dst = data.src;
        resp.id = data.id;
        socket.send(JSON.stringify(resp));
    }, true)
}

function handleRelayCommands(socket: WebSocket.WebSocket, data: incoming_jsonrpc) {
    if (typeof data.dst === 'string') {
        singleRelayCommand(socket, data.dst, data);
    } else if (typeof data.dst === 'object' && Array.isArray(data.dst)) {
        for (const dst of data.dst) if (typeof dst === 'string') {
            singleRelayCommand(socket, dst, data);
        }
    } else {
        socket.send(JSON.stringify(
            buildOutgoingJsonRpcError(ERROR_CODES.INVALID_REQUEST, data.id, undefined, "bad dst argument")
        ));
    }
}

async function handleInternalCommands(socket: WebSocket.WebSocket, data: incoming_jsonrpc, user: { group: string, permissions: string[] }) {
    const params = data.params;
    
    try {
        const commander = Commander.getInstance()
        const result = await commander.exec({
            group: user.group,
            permissions: user.permissions,
            additional: {
                socket
            }
        }, data.method, params);
        socket.send(JSON.stringify(buildOutgoingJsonRpc(data.id, data.src, result)))
    } catch (err: any) {
        let { error, error_code } = err;
        error ??= err.message;
        logger.fatal("Sending error_code:[%s] msg:[%s] method:[%s] params:[%s]", error_code, error, data.method, params);
        logger.fatal(err)
        if (error_code != undefined) {
            socket.send(JSON.stringify(
                buildOutgoingJsonRpcError(error_code, data.id, data.src, error || null)
            ));
            return;
        }
        socket.send(JSON.stringify(
            buildOutgoingJsonRpcError(ERROR_CODES.SERVER_ERROR, data.id, data.src, error || null)
        ));
    }
}

function handleIncomingMessage(socket: WebSocket.WebSocket, data: incoming_jsonrpc, user: { group: string, permissions: string[] }) {
    if (!parseIncomingJsonRpc(data)) {
        logger.warn("error parsing incoming ws data");
        socket.send(JSON.stringify(
            buildOutgoingJsonRpcError(ERROR_CODES.INVALID_REQUEST, null)
        ));
        return;
    }

    // handle internal commands
    if (data.method.toLocaleLowerCase().startsWith('fleetmanager') || data.dst === 'FLEET_MANAGER') {
        handleInternalCommands(socket, data, user);
        return;
    }

    if (typeof data.dst !== 'undefined') {
        handleRelayCommands(socket, data);
        return;
    }

    // always respond
    logger.warn("unhandled ws data");
    socket.send(JSON.stringify(
        buildOutgoingJsonRpcError(ERROR_CODES.INVALID_REQUEST, null)
    ));
}

export function notifyAll(msg: string) {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    })
}