import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import type { WebSocket, RawData } from "ws";
import { config } from "./config.js";
import { getServerQuery, getChannelTree, kickClient, moveClient, banClient } from "./admin/serverQuery.js";
import { openVoiceSession, closeVoiceSession, getVoiceSession } from "./voice/voiceSessions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

// ---- Единый пароль на весь сайт (HTTP Basic Auth) -------------------------
// Пароль совпадает с TS3_SERVER_PASSWORD — паролем подключения к самому TS3-серверу
// (не ServerQuery). Работает и для статики, и для WS-апгрейдов (браузер сам
// подставляет закэшированные Basic-креды в запрос на апгрейд того же origin).
app.addHook("onRequest", async (request, reply) => {
  const authHeader = request.headers.authorization;
  const password = authHeader?.startsWith("Basic ")
    ? Buffer.from(authHeader.slice(6), "base64").toString("utf8").split(":")[1]
    : undefined;

  if (password !== config.ts3.serverPassword) {
    reply.header("WWW-Authenticate", 'Basic realm="ts3web"');
    return reply.code(401).send("Unauthorized");
  }
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "public"),
});
await app.register(fastifyWebsocket);

// ---- Админка: дерево каналов/юзеров + модерация -------------------------

const adminSockets = new Set<WebSocket>();

async function broadcastChannelTree() {
  const tree = await getChannelTree();
  const payload = JSON.stringify({ type: "tree", tree });
  for (const socket of adminSockets) socket.send(payload);
}

app.register(async (instance) => {
  instance.get("/ws/admin", { websocket: true }, (socket) => {
    adminSockets.add(socket);
    void broadcastChannelTree();

    socket.on("message", async (raw: RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "kick") {
          await kickClient(msg.clientId, msg.scope ?? "channel", msg.reason);
        } else if (msg.type === "move") {
          await moveClient(msg.clientId, msg.channelId, msg.channelPassword);
        } else if (msg.type === "ban") {
          await banClient(msg.clientId, msg.durationSeconds ?? 0, msg.reason);
        }
        await broadcastChannelTree();
      } catch (err) {
        socket.send(JSON.stringify({ type: "error", message: String(err) }));
      }
    });

    socket.on("close", () => adminSockets.delete(socket));
  });
});

// Живые обновления: переподписываемся на события ServerQuery и рассылаем дерево заново.
getServerQuery()
  .then((ts3) => {
    const events = ["clientconnect", "clientdisconnect", "clientmoved", "channeledit", "channelcreate", "channeldelete"];
    for (const event of events) {
      ts3.on(event as never, () => void broadcastChannelTree());
    }
  })
  .catch((err) => app.log.error(err, "не удалось подключиться к ServerQuery при старте"));

// ---- Голос: сигналинг WebRTC ---------------------------------------------

app.register(async (instance) => {
  instance.get("/ws/voice", { websocket: true }, (socket) => {
    const connectionId = randomUUID();

    socket.on("message", async (raw: RawData) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "join") {
        const session = await openVoiceSession(connectionId, msg.channelName);
        session.pc.onicecandidate = ({ candidate }) => {
          if (candidate) socket.send(JSON.stringify({ type: "ice", candidate }));
        };

        const offer = await session.pc.createOffer();
        await session.pc.setLocalDescription(offer);
        socket.send(JSON.stringify({ type: "offer", sdp: session.pc.localDescription }));
        return;
      }

      const session = getVoiceSession(connectionId);
      if (!session) return;

      if (msg.type === "answer") {
        await session.pc.setRemoteDescription(msg.sdp);
      } else if (msg.type === "ice" && msg.candidate) {
        await session.pc.addIceCandidate(msg.candidate);
      }
    });

    socket.on("close", () => void closeVoiceSession(connectionId));
  });
});

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
