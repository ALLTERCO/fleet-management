import {onUnmounted, type Ref, ref} from 'vue';
import {sendRPC} from '@/tools/websocket';

// ---------------------------------------------------------------------------
// ICE server config
// ---------------------------------------------------------------------------

const ICE_SERVERS: RTCIceServer[] = [
    {
        urls: 'turn:turn.shelly.cloud:3478',
        username: 'admin2',
        credential: 'admin2'
    },
    {urls: 'stun:stun.shelly.cloud:3478'}
];

/** Formatted for Shelly's Streamer ice_servers param */
const FORMATTED_SERVERS = ICE_SERVERS.map((s: any) => {
    if (s.username && s.credential) {
        return s.urls.replace(':', `://${s.username}:${s.credential}@`);
    }
    return s.urls;
});

const CONNECTION_TIMEOUT = 15_000;
const MAX_RECONNECTS = 50;
const RECONNECT_DELAY = 1_000;

// ---------------------------------------------------------------------------
// Composable — uses the same Streamer.Offer / Streamer.Answer flow
// as the camera's own local web UI, with auto-reconnect
// ---------------------------------------------------------------------------

export function useWebRtcStream(shellyID: Ref<string | undefined>) {
    const streaming = ref(false);
    const connecting = ref(false);
    const error = ref<string | null>(null);
    const videoEl = ref<HTMLVideoElement | null>(null);

    let pc: RTCPeerConnection | null = null;
    let sessionId: string | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastStreamId = 0;
    let reconnectCount = 0;
    let stopped = false;

    // -- helpers --

    function callFm<T = any>(
        method: string,
        params: Record<string, unknown>
    ): Promise<T> {
        const id = shellyID.value;
        if (!id) return Promise.reject(new Error('No device'));
        return sendRPC<T>('FLEET_MANAGER', method, {shellyID: id, ...params});
    }

    function teardown() {
        if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = null;
        }
        if (pc) {
            if (pc.getTransceivers) {
                for (const t of pc.getTransceivers()) {
                    if (t.stop) t.stop();
                }
            }
            for (const sender of pc.getSenders()) {
                if (sender.track) sender.track.stop();
            }
            pc.ontrack = null;
            pc.onconnectionstatechange = null;
            pc.onicecandidate = null;
            pc.onicegatheringstatechange = null;
            const closingPc = pc;
            setTimeout(() => closingPc.close(), 500);
            pc = null;
        }
        if (videoEl.value) {
            videoEl.value.srcObject = null;
        }
        sessionId = null;
    }

    function reconnect() {
        if (stopped || reconnectCount >= MAX_RECONNECTS) return;
        reconnectCount++;
        teardown();
        setTimeout(() => {
            if (!stopped) initConnection(lastStreamId);
        }, RECONNECT_DELAY);
    }

    /**
     * Camera local UI flow (Streamer.Offer / Streamer.Answer):
     * 1. Streamer.Offer — send ICE servers, device returns its SDP offer + candidates
     * 2. Create PeerConnection, set device's offer as remoteDescription
     * 3. Add device ICE candidates
     * 4. Create answer, set as localDescription
     * 5. On ICE gathering complete → Streamer.Answer with client's SDP + candidates
     * Auto-reconnects on failure (matches camera's own web UI behavior).
     */
    async function initConnection(streamId: number) {
        if (stopped) return;
        connecting.value = true;
        error.value = null;

        connectTimer = setTimeout(() => {
            if (connecting.value && !streaming.value) {
                reconnect();
            }
        }, CONNECTION_TIMEOUT);

        try {
            // 1. Request offer from device
            const offerResp = await callFm('Camera.Streamer.Offer', {
                ice_servers: FORMATTED_SERVERS,
                stream_id: streamId
            });

            if (!offerResp?.sdp)
                throw new Error('Device did not return an SDP offer');

            sessionId = offerResp.session_id ?? null;

            // Parse SDP — device may double-wrap as JSON string
            let deviceSdp: string;
            try {
                deviceSdp = JSON.parse(offerResp.sdp).sdp;
            } catch {
                deviceSdp = offerResp.sdp;
            }

            // 2. Create PeerConnection
            pc = new RTCPeerConnection({
                bundlePolicy: 'max-bundle',
                iceServers: ICE_SERVERS
            });

            let gotRemoteTrack = false;

            pc.ontrack = (e) => {
                if (e.track.kind === 'video') {
                    gotRemoteTrack = true;
                    const stream = e.streams?.[0] ?? new MediaStream([e.track]);
                    if (videoEl.value) {
                        videoEl.value.srcObject = stream;
                        videoEl.value.muted = true;
                        videoEl.value.play().catch(() => {});
                        streaming.value = true;
                        connecting.value = false;
                        reconnectCount = 0;
                        if (connectTimer) {
                            clearTimeout(connectTimer);
                            connectTimer = null;
                        }
                    }
                } else if (
                    e.track.kind === 'audio' &&
                    videoEl.value?.srcObject
                ) {
                    const existing = videoEl.value.srcObject as MediaStream;
                    if (existing.getAudioTracks().length === 0) {
                        existing.addTrack(e.track);
                    }
                }
            };

            // Auto-reconnect on failure (camera's UI does the same)
            pc.onconnectionstatechange = () => {
                const state = pc?.connectionState;
                if (state === 'failed') {
                    reconnect();
                }
                if (state === 'connected') {
                    if (connectTimer) {
                        clearTimeout(connectTimer);
                        connectTimer = null;
                    }
                }
            };

            // 3. Set device's SDP offer as remote description
            await pc.setRemoteDescription({type: 'offer', sdp: deviceSdp});

            // Add device's ICE candidates
            const deviceCandidates = offerResp.candidates ?? [];
            for (const c of deviceCandidates) {
                await pc.addIceCandidate(
                    new RTCIceCandidate({
                        candidate: c.candidate,
                        sdpMid: c.sdp_mid,
                        sdpMLineIndex: c.sdp_m_line_index
                    })
                );
            }

            // 4. Create answer
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            // 5. Send answer when ICE gathering completes
            let answerSent = false;
            const sendAnswer = () => {
                if (answerSent || !pc || !sessionId) return;
                answerSent = true;
                callFm('Camera.Streamer.Answer', {
                    session_id: sessionId,
                    sdp: pc.localDescription?.sdp,
                    candidates: [],
                    end_of_candidates: true
                }).catch(() => {});
            };

            pc.onicegatheringstatechange = () => {
                if (pc?.iceGatheringState === 'complete') sendAnswer();
            };
            if (pc.iceGatheringState === 'complete') sendAnswer();

            // Fallback: if ontrack hasn't fired, bind video from receiver
            if (!gotRemoteTrack) {
                setTimeout(() => {
                    if (gotRemoteTrack || !pc) return;
                    const receiver = pc
                        .getReceivers()
                        .find((r) => r.track?.kind === 'video');
                    if (receiver?.track && videoEl.value) {
                        videoEl.value.srcObject = new MediaStream([
                            receiver.track
                        ]);
                        videoEl.value.muted = true;
                        videoEl.value.play().catch(() => {});
                        streaming.value = true;
                        connecting.value = false;
                        reconnectCount = 0;
                        if (connectTimer) {
                            clearTimeout(connectTimer);
                            connectTimer = null;
                        }
                    }
                }, 250);
            }
        } catch (e: any) {
            connecting.value = false;
            if (!stopped && reconnectCount < MAX_RECONNECTS) {
                reconnect();
            } else {
                error.value = e.message || 'Failed to start stream';
                teardown();
            }
        }
    }

    // -- public API --

    function start(streamId = 0) {
        if (streaming.value || connecting.value) return;
        stopped = false;
        reconnectCount = 0;
        lastStreamId = streamId;
        initConnection(streamId);
    }

    function stop() {
        stopped = true;
        teardown();
        streaming.value = false;
        connecting.value = false;
        error.value = null;
    }

    async function changeStream(streamId: number) {
        if (!sessionId) return;
        lastStreamId = streamId;
        try {
            await callFm('Camera.Streamer.SetStreamSource', {
                session_id: sessionId,
                stream_id: streamId
            });
        } catch (e: any) {
            error.value = e.message || 'Failed to switch stream';
        }
    }

    onUnmounted(() => {
        stopped = true;
        teardown();
    });

    return {streaming, connecting, error, videoEl, start, stop, changeStream};
}
