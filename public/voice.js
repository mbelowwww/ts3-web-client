const remoteAudio = document.getElementById("remoteAudio");
const channelInput = document.getElementById("channelName");
const joinButton = document.getElementById("joinVoice");
const toggleMicButton = document.getElementById("toggleMic");

let socket;
let pc;
let micTrack;

toggleMicButton.addEventListener("click", () => {
  micTrack.enabled = !micTrack.enabled;
  toggleMicButton.textContent = micTrack.enabled ? "Выключить микрофон" : "Включить микрофон";
});

joinButton.addEventListener("click", async () => {
  joinButton.disabled = true;

  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${wsProtocol}//${location.host}/ws/voice`);
  pc = new RTCPeerConnection();

  pc.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.send(JSON.stringify({ type: "ice", candidate: event.candidate }));
  };

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "join", channelName: channelInput.value }));
  });

  socket.addEventListener("message", async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "offer") {
      await pc.setRemoteDescription(msg.sdp);

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      [micTrack] = micStream.getAudioTracks();
      pc.addTrack(micTrack, micStream);
      toggleMicButton.disabled = false;

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.send(JSON.stringify({ type: "answer", sdp: pc.localDescription }));
    } else if (msg.type === "ice") {
      await pc.addIceCandidate(msg.candidate);
    }
  });
});
