import { Client as Ts3VoiceClient, generateIdentity, type VoiceData } from "@honeybbq/teamspeak-client";
import { RTCPeerConnection, RtpPacket, RtpHeader, MediaStreamTrack } from "werift";
import { config } from "../config.js";

// Opus @ 48kHz, кадр 20мс -> 960 сэмплов на пакет.
const FRAME_SAMPLES = 960;
// TS3-протокол: кодек голоса. 4 = CODEC_OPUS_VOICE (см. ts3-web-client-plan.md, §5).
const CODEC_OPUS_VOICE = 4;

export interface VoiceSession {
  pc: RTCPeerConnection;
  close: () => Promise<void>;
}

/**
 * Вертикальный срез §7.3+7.4 (ts3-web-client-plan.md): приём и передача голоса
 * между TS3-каналом и браузером. На каждого веб-юзера — отдельный TS3-клиент
 * (honeybbq), чтобы человек заходил под своей личностью и в своих правах,
 * а не через общего бота.
 */
export async function createVoiceSession(channelName: string): Promise<VoiceSession> {
  const identity = generateIdentity(8);
  const nickname = `${config.ts3.bridgeNicknamePrefix}-${Math.random().toString(36).slice(2, 8)}`;

  const ts3Voice = new Ts3VoiceClient(identity, config.ts3.voiceHost, nickname, {
    defaultChannel: channelName,
    serverPassword: config.ts3.serverPassword,
  });

  const pc = new RTCPeerConnection();
  // addTransceiver("audio", ...) без явного трека не создаёт MediaStreamTrack
  // (sender.track остаётся null) — поэтому трек для исходящего (TS3 -> браузер)
  // направления создаём сами. sendrecv, т.к. этот же transceiver несёт и входящий
  // (браузер -> TS3) трек микрофона.
  const track = new MediaStreamTrack({ kind: "audio" });
  const transceiver = pc.addTransceiver(track, { direction: "sendrecv" });

  // Микрофон браузера -> TS3-канал. transceiver.receiver.track в момент создания
  // transceiver'а — временная заглушка (werift ещё не знает SSRC входящего потока);
  // реальный трек с настоящими RTP-событиями появляется только после SDP-négotiation
  // по SSRC, через pc.onTrack. Подписка на receiver.track сразу после addTransceiver
  // молча ловит события с "неправильного" (уже не используемого) объекта трека —
  // проверено вживую через synthetic round-trip тест (два werift-клиента в одном
  // канале): без onTrack сервер видел входящие RTP (демультиплексация и кодек
  // совпадали), но подписчик их не получал.
  pc.onTrack.subscribe((remoteTrack) => {
    remoteTrack.onReceiveRtp.subscribe((rtp) => {
      ts3Voice.sendVoice(rtp.payload, CODEC_OPUS_VOICE);
    });
  });

  let seq = Math.floor(Math.random() * 0xffff);
  let timestamp = Math.floor(Math.random() * 0xffffffff);
  const ssrc = Math.floor(Math.random() * 0xffffffff);

  ts3Voice.on("voiceData", (voice: VoiceData) => {
    // payloadType должен совпадать с тем, что werift реально согласовал для Opus
    // на этом transceiver'е — оно не всегда 111 (в тестах наблюдался и PT 96,
    // в зависимости от того, какие ещё кодеки участвуют в offer/answer).
    const opusCodec = transceiver.codecs.find((c) => c.mimeType.toLowerCase() === "audio/opus");
    const header = new RtpHeader({
      payloadType: opusCodec?.payloadType ?? 111,
      sequenceNumber: seq,
      timestamp,
      ssrc,
      marker: false,
    });
    seq = (seq + 1) % 0x10000;
    timestamp = (timestamp + FRAME_SAMPLES) % 0x100000000;

    track.writeRtp(new RtpPacket(header, Buffer.from(voice.data)));
  });

  ts3Voice.on("disconnected", () => {
    void close();
  });

  await ts3Voice.connect();
  await ts3Voice.waitConnected(AbortSignal.timeout(15_000));

  const close = async () => {
    await ts3Voice.disconnect();
    pc.close();
  };

  return { pc, close };
}
