import * as http from "http";
import { wss as shellyWss } from "./shelly";
import { wss as mountWss } from "./mount";
import { wss } from "./index";
import { parse } from 'url';
import * as DeviceManager from "../../DeviceManager"
import { getLogger } from "log4js";
const logger = getLogger('ws upgrade');
import * as QuickTokens from "../QuickTokens";
import * as User from "../../model/User";

function destroySocket(socket: any, httpTextStatus: '401 Unauthorized' | '403 Forbidden') {
    logger.debug('destroying websocket reason:[%s]', httpTextStatus);
    socket.write(`HTTP/1.1 ${httpTextStatus}\r\n\r\n`);
    socket.destroy();
}

export default (server: http.Server) => {
    server.on('upgrade', function upgrade(request, socket, head) {
        if (request.url == undefined) {
            logger.debug('destroying bad socket');
            socket.destroy();
            return;
        }
        const { pathname } = parse(request.url);

        if (pathname == null) {
            logger.debug('destroying bad socket');
            socket.destroy();
            return;
        }

        // handle without authentication
        if (pathname === '/shelly') {
            shellyWss.handleUpgrade(request, socket, head, (ws) => {
                shellyWss.emit('connection', ws, request);
            });
            return;
        }

        // special authentication for mounting
        if (pathname.startsWith('/mount/')) {
            const shellyID = pathname.split('/')[2];
            if (DeviceManager.getDevice(shellyID) == undefined) {
                socket.destroy();
                return;
            }

            const cookiesRaw = request.headers.cookie;
            if (cookiesRaw == undefined) {
                socket.destroy();
                return;
            }

            let quickToken: string | undefined = undefined;
            for (let cookie of cookiesRaw.split(";")) {
                cookie = cookie.trimStart();
                const splitted = cookie.split('=');
                if (splitted[0] == 'fleet-manager-quick-token') {
                    quickToken = splitted[1]
                }
            }

            if (quickToken == undefined) {
                socket.destroy();
                return;
            }

            const permission = QuickTokens.useToken(quickToken);

            if (permission != `${shellyID}.mount`) {
                socket.destroy();
                return;
            }

            logger.info("upgrading shellyID mount", shellyID)
            mountWss.handleUpgrade(request, socket, head, (ws) => {
                request.headers['shellyID'] = shellyID;
                mountWss.emit('connection', ws, request);
            });

            return;
        }

        let protocol = request.headers['sec-websocket-protocol'];
        let auth: string | undefined = undefined;

        if (typeof protocol === 'string' && protocol.length > 0) {
            auth = 'Bearer ' + protocol;
        } else {
            let authorization = request.headers['authorization'];
            if (typeof authorization === 'string' && authorization.length > 0) {
                auth = authorization;
            }
        }

        let token: string;

        if (User.allowDebug) {
            logger.warn("Allowing a debug token");
            token = User.generateDebugToken()
        } else {
            // no authorization, close ws
            if (typeof auth !== 'string' || auth.length == 0) {
                destroySocket(socket, '401 Unauthorized')
                return;
            }
            const extracted = auth.split(" ").at(-1)!;
            logger.info("websocket token:[%s]", extracted)

            // no token, close ws
            if (extracted == undefined) {
                destroySocket(socket, '401 Unauthorized')
                return;
            }

            token = extracted;
        }

        if (pathname === '/') {
            wss.handleUpgrade(request, socket, head, (ws) => {
                request.headers['token'] = token;
                wss.emit('connection', ws, request);
            });
        } else {
            socket.destroy();
        }
    });
}
