import WebSocket from "ws";
import { RTCPeerConnection, RtpPacket, RtpHeader, MediaStreamTrack } from "werift";

const SERVER = "ws://127.0.0.1:3000/ws/voice";
const CHANNEL = "SendTest";

function createClient(name) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(SERVER);
    const pc = new RTCPeerConnection();
    const localTrack = new MediaStreamTrack({ kind: "audio" });
    const received = [];

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.send(JSON.stringify({ type: "ice", candidate }));
    };
    pc.onconnectionstatechange = () => console.log(`[${name}] connectionState:`, pc.connectionState);
    pc.oniceconnectionstatechange = () => console.log(`[${name}] iceConnectionState:`, pc.iceConnectionState);

    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "join", channelName: CHANNEL }));
    });

    socket.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "offer") {
          console.log(`[${name}] offer SDP from server:\n` + msg.sdp.sdp);
          await pc.setRemoteDescription(msg.sdp);
          pc.addTrack(localTrack);
          for (const transceiver of pc.getTransceivers()) {
            transceiver.receiver.track.onReceiveRtp.subscribe((rtp) => {
              received.push(rtp.payload);
            });
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log(`[${name}] answer SDP:\n` + pc.localDescription.sdp);
          socket.send(JSON.stringify({ type: "answer", sdp: pc.localDescription }));
          resolve({ name, socket, pc, localTrack, getReceived: () => received });
        } else if (msg.type === "ice" && msg.candidate) {
          await pc.addIceCandidate(msg.candidate);
        }
      } catch (err) {
        reject(err);
      }
    });

    socket.on("error", reject);
  });
}

const clientA = await createClient("A");
const clientB = await createClient("B");
console.log("both clients joined, waiting for ICE/DTLS to settle...");

await new Promise((r) => setTimeout(r, 6000));
console.log("A connectionState:", clientA.pc.connectionState, "iceConnectionState:", clientA.pc.iceConnectionState);
console.log("B connectionState:", clientB.pc.connectionState, "iceConnectionState:", clientB.pc.iceConnectionState);

const senderSsrc = clientA.pc.getTransceivers()[0].sender.ssrc;
const opusCodec = clientA.pc.getTransceivers()[0].codecs.find((c) => c.mimeType.toLowerCase().includes("opus"));
console.log("A starts sending synthetic mic packets with sender.ssrc =", senderSsrc, "opus payloadType =", opusCodec?.payloadType);
let seq = 1000;
let ts = 1000;
const ssrc = senderSsrc;
const interval = setInterval(() => {
  const header = new RtpHeader({ payloadType: opusCodec.payloadType, sequenceNumber: seq, timestamp: ts, ssrc, marker: false });
  seq = (seq + 1) % 0x10000;
  ts = (ts + 960) % 0x100000000;
  const payload = Buffer.from(`hello-from-A-seq${seq}`);
  clientA.localTrack.writeRtp(new RtpPacket(header, payload));
}, 20);

await new Promise((r) => setTimeout(r, 3000));
clearInterval(interval);

const receivedB = clientB.getReceived();
console.log("B received packet count:", receivedB.length);
console.log("Sample payloads on B:", receivedB.slice(0, 3).map((b) => b.toString()));

const receivedA = clientA.getReceived();
console.log("A received packet count (should be ~0, B wasn't sending):", receivedA.length);

clientA.socket.close();
clientB.socket.close();
clientA.pc.close();
clientB.pc.close();
setTimeout(() => process.exit(0), 500);
