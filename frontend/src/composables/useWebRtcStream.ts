import {onUnmounted, type Ref, ref, watch} from 'vue';
import {FLEET_MANAGER_HTTP} from '@/constants';
import {sendRPC} from '@/tools/websocket';

// STUN the device uses to prepare its offer.
const ICE_SERVERS: RTCIceServer[] = [{urls: 'stun:stun.shelly.cloud:3478'}];

// String form for the Streamer.Offer `ice_servers` param.
const FORMATTED_SERVERS = ICE_SERVERS.map((s: any) =>
    s.username && s.credential
        ? s.urls.replace(':', `://${s.username}:${s.credential}@`)
        : s.urls
);

const CONNECTION_TIMEOUT = 15_000;
// Low: each reconnect opens a fresh session, and slots are limited.
const MAX_RECONNECTS = 5;
const RECONNECT_DELAY = 1_000;

// Ref-counted session per camera: all viewers share one slot, freed when the
// last leaves. State fans out to each viewer's own refs.

interface Subscriber {
    streaming: Ref<boolean>;
    connecting: Ref<boolean>;
    error: Ref<string | null>;
    videoEl: Ref<HTMLVideoElement | null>;
}

interface Session {
    shellyID: string;
    pc: RTCPeerConnection | null;
    sessionId: string | null;
    stream: MediaStream | null;
    streamId: number;
    reconnectCount: number;
    stopped: boolean;
    pausedForHidden: boolean;
    connectTimer: ReturnType<typeof setTimeout> | null;
    subs: Set<Subscriber>;
    live: boolean; // remote video track bound
    busy: boolean; // connecting/negotiating
    err: string | null;
}

const sessions = new Map<string, Session>();

// Last session id per camera, so the unload beacon can free the slot.
const lastSession = new Map<string, string>();

// A slots-full camera answers Offer with a preparation timeout.
export function busyMessage(raw: string | undefined): string {
    const m = raw ?? '';
    if (/preparation timeout|busy|in use|slot|too many/i.test(m)) {
        return 'Camera busy. All stream slots are in use, try again shortly.';
    }
    return m || 'Failed to start stream';
}

function getSession(shellyID: string): Session {
    let s = sessions.get(shellyID);
    if (!s) {
        s = {
            shellyID,
            pc: null,
            sessionId: null,
            stream: null,
            streamId: 0,
            reconnectCount: 0,
            stopped: false,
            pausedForHidden: false,
            connectTimer: null,
            subs: new Set(),
            live: false,
            busy: false,
            err: null
        };
        sessions.set(shellyID, s);
    }
    return s;
}

function callFm<T = any>(
    shellyID: string,
    method: string,
    params: Record<string, unknown>
): Promise<T> {
    return sendRPC<T>('FLEET_MANAGER', method, {shellyID, ...params});
}

// Push the session's state onto every viewer so they all reflect the same slot.
function fanout(s: Session) {
    for (const sub of s.subs) {
        sub.streaming.value = s.live;
        sub.connecting.value = s.busy;
        sub.error.value = s.err;
    }
}

function bindVideo(el: HTMLVideoElement | null, stream: MediaStream | null) {
    if (!el || !stream) return;
    el.srcObject = stream;
    el.muted = true;
    el.play().catch(() => {});
}

function bindAll(s: Session) {
    if (!s.stream) return;
    for (const sub of s.subs) bindVideo(sub.videoEl.value, s.stream);
}

function teardown(s: Session) {
    if (s.connectTimer) {
        clearTimeout(s.connectTimer);
        s.connectTimer = null;
    }
    if (s.pc) {
        if (s.pc.getTransceivers) {
            for (const t of s.pc.getTransceivers()) {
                if (t.stop) t.stop();
            }
        }
        for (const sender of s.pc.getSenders()) {
            if (sender.track) sender.track.stop();
        }
        s.pc.ontrack = null;
        s.pc.onconnectionstatechange = null;
        s.pc.onicecandidate = null;
        s.pc.onicegatheringstatechange = null;
        const closing = s.pc;
        setTimeout(() => closing.close(), 500);
        s.pc = null;
    }
    for (const sub of s.subs) {
        if (sub.videoEl.value) sub.videoEl.value.srcObject = null;
    }
    s.stream = null;
}

// End the device session to free its slot.
function stopDeviceSession(s: Session) {
    const id = s.sessionId;
    if (!id) return;
    s.sessionId = null;
    callFm(s.shellyID, 'Camera.Streamer.StopStream', {session_id: id}).catch(
        () => {}
    );
}

function reconnect(s: Session) {
    if (s.stopped || s.reconnectCount >= MAX_RECONNECTS) return;
    s.reconnectCount++;
    stopDeviceSession(s);
    teardown(s);
    setTimeout(() => {
        if (!s.stopped) initConnection(s, s.streamId);
    }, RECONNECT_DELAY);
}

// Non-trickle Streamer flow: the device offers, the client answers.
async function initConnection(s: Session, streamId: number) {
    if (s.stopped) return;
    s.busy = true;
    s.err = null;
    fanout(s);

    s.connectTimer = setTimeout(() => {
        if (s.busy && !s.live) reconnect(s);
    }, CONNECTION_TIMEOUT);

    try {
        const offerResp = await callFm(s.shellyID, 'Camera.Streamer.Offer', {
            ice_servers: FORMATTED_SERVERS,
            stream_id: streamId
        });
        if (!offerResp?.sdp)
            throw new Error('Device did not return an SDP offer');
        s.sessionId = offerResp.session_id ?? null;
        if (s.sessionId) lastSession.set(s.shellyID, s.sessionId);

        let deviceSdp: string;
        try {
            deviceSdp = JSON.parse(offerResp.sdp).sdp;
        } catch {
            deviceSdp = offerResp.sdp;
        }

        const pc = new RTCPeerConnection({
            bundlePolicy: 'max-bundle',
            iceServers: ICE_SERVERS
        });
        s.pc = pc;
        let gotRemoteTrack = false;

        const markLive = () => {
            bindAll(s);
            s.live = true;
            s.busy = false;
            s.reconnectCount = 0;
            fanout(s);
            if (s.connectTimer) {
                clearTimeout(s.connectTimer);
                s.connectTimer = null;
            }
        };

        pc.ontrack = (e) => {
            if (e.track.kind === 'video') {
                gotRemoteTrack = true;
                s.stream = e.streams?.[0] ?? new MediaStream([e.track]);
                markLive();
            } else if (e.track.kind === 'audio' && s.stream) {
                if (s.stream.getAudioTracks().length === 0) {
                    s.stream.addTrack(e.track);
                }
            }
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === 'failed') reconnect(s);
            if (state === 'connected' && s.connectTimer) {
                clearTimeout(s.connectTimer);
                s.connectTimer = null;
            }
        };

        await pc.setRemoteDescription({type: 'offer', sdp: deviceSdp});
        for (const c of offerResp.candidates ?? []) {
            await pc.addIceCandidate(
                new RTCIceCandidate({
                    candidate: c.candidate,
                    sdpMid: c.sdp_mid,
                    sdpMLineIndex: c.sdp_m_line_index
                })
            );
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        let answerSent = false;
        const sendAnswer = () => {
            if (answerSent || !s.pc || !s.sessionId) return;
            answerSent = true;
            callFm(s.shellyID, 'Camera.Streamer.Answer', {
                session_id: s.sessionId,
                sdp: s.pc.localDescription?.sdp,
                candidates: [],
                end_of_candidates: true
            }).catch(() => {});
        };
        pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') sendAnswer();
        };
        if (pc.iceGatheringState === 'complete') sendAnswer();

        // Fallback: if ontrack hasn't fired, bind video from the receiver.
        if (!gotRemoteTrack) {
            setTimeout(() => {
                if (gotRemoteTrack || !s.pc) return;
                const receiver = s.pc
                    .getReceivers()
                    .find((r) => r.track?.kind === 'video');
                if (receiver?.track) {
                    s.stream = new MediaStream([receiver.track]);
                    markLive();
                }
            }, 250);
        }
    } catch (e: any) {
        s.busy = false;
        fanout(s);
        if (!s.stopped && s.reconnectCount < MAX_RECONNECTS) {
            reconnect(s);
        } else {
            s.err = busyMessage(e.message);
            fanout(s);
            teardown(s);
        }
    }
}

function startSession(s: Session, streamId: number) {
    // Already live: a new viewer binds to the shared stream, no new slot.
    if (s.live) {
        bindAll(s);
        return;
    }
    if (s.busy) return;
    s.stopped = false;
    s.reconnectCount = 0;
    s.streamId = streamId;
    initConnection(s, streamId);
}

function stopSession(s: Session) {
    s.stopped = true;
    stopDeviceSession(s);
    teardown(s);
    s.live = false;
    s.busy = false;
    s.err = null;
    fanout(s);
}

// Free the slot while the tab is hidden; resume when it returns.
function handleVisibility() {
    const hidden =
        typeof document !== 'undefined' ? document.hidden : false;
    for (const s of sessions.values()) {
        if (hidden) {
            if (s.live || s.busy) {
                s.pausedForHidden = true;
                stopDeviceSession(s);
                teardown(s);
                s.live = false;
                s.busy = false;
                fanout(s);
            }
        } else if (s.pausedForHidden && s.subs.size > 0) {
            s.pausedForHidden = false;
            s.stopped = false;
            s.reconnectCount = 0;
            initConnection(s, s.streamId);
        }
    }
}

// Free the slot on page unload; keepalive survives it and carries auth.
function beaconStop(shellyID: string, sessionId: string) {
    const token =
        localStorage.getItem('dev_mode_token') ||
        sessionStorage.getItem('access_token');
    fetch(
        `${FLEET_MANAGER_HTTP}/api/device-proxy/${shellyID}/camera/streamer/stop`,
        {
            method: 'POST',
            keepalive: true,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? {Authorization: `Bearer ${token}`} : {})
            },
            body: JSON.stringify({session_id: sessionId})
        }
    ).catch(() => {});
}

function releaseAllOnUnload() {
    for (const [shellyID, sessionId] of lastSession) {
        beaconStop(shellyID, sessionId);
    }
}

let listenersBound = false;
function ensureGlobalListeners() {
    if (listenersBound || typeof document === 'undefined') return;
    listenersBound = true;
    document.addEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', releaseAllOnUnload);
    }
}

// One instance per view; joins the shared per-camera session.
export function useWebRtcStream(shellyID: Ref<string | undefined>) {
    ensureGlobalListeners();

    const streaming = ref(false);
    const connecting = ref(false);
    const error = ref<string | null>(null);
    const videoEl = ref<HTMLVideoElement | null>(null);
    const sub: Subscriber = {streaming, connecting, error, videoEl};
    let joined: Session | null = null;

    // Bind the video if it mounts after the shared stream is already live.
    watch(videoEl, (el) => {
        if (el && joined?.live && joined.stream) bindVideo(el, joined.stream);
    });

    function start(streamId = 0) {
        const id = shellyID.value;
        if (!id) return;
        const s = getSession(id);
        if (joined && joined !== s) release();
        if (joined !== s) {
            s.subs.add(sub);
            joined = s;
            streaming.value = s.live;
            connecting.value = s.busy;
            error.value = s.err;
            bindVideo(videoEl.value, s.stream);
        }
        startSession(s, streamId);
    }

    function release() {
        if (!joined) return;
        const s = joined;
        s.subs.delete(sub);
        if (videoEl.value) videoEl.value.srcObject = null;
        streaming.value = false;
        connecting.value = false;
        // Last viewer gone: free the device slot now.
        if (s.subs.size === 0) {
            stopSession(s);
            sessions.delete(s.shellyID);
            lastSession.delete(s.shellyID);
        }
        joined = null;
    }

    function stop() {
        release();
    }

    async function changeStream(streamId: number) {
        const s = joined;
        if (!s || !s.sessionId) return;
        s.streamId = streamId;
        try {
            await callFm(s.shellyID, 'Camera.Streamer.SetStreamSource', {
                session_id: s.sessionId,
                stream_id: streamId
            });
        } catch (e: any) {
            s.err = e.message || 'Failed to switch stream';
            fanout(s);
        }
    }

    onUnmounted(() => release());

    return {streaming, connecting, error, videoEl, start, stop, changeStream};
}
