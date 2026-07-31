import { TeamSpeak, QueryProtocol, ReasonIdentifier, ClientType } from "ts3-nodejs-library";
import { config } from "../config.js";

let connection: TeamSpeak | null = null;
let connecting: Promise<TeamSpeak> | null = null;

export async function getServerQuery(): Promise<TeamSpeak> {
  if (connection) return connection;
  if (connecting) return connecting;

  connecting = TeamSpeak.connect({
    host: config.ts3.host,
    queryport: config.ts3.queryPort,
    serverport: config.ts3.voicePort,
    username: config.ts3.queryUser,
    password: config.ts3.queryPassword,
    nickname: config.ts3.queryNickname,
    protocol: config.ts3.queryProtocol === "ssh" ? QueryProtocol.SSH : QueryProtocol.RAW,
  }).then((ts3) => {
    connection = ts3;
    ts3.on("close", () => {
      connection = null;
    });
    ts3.on("error", (err) => {
      console.error("[ts3 serverquery] unhandled event error:", err);
    });
    return ts3;
  });

  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

export interface ChannelTreeClient {
  id: string;
  nickname: string;
  talkPower: number;
}

export interface ChannelTreeNode {
  id: string;
  parentId: string;
  name: string;
  order: number;
  clients: ChannelTreeClient[];
}

export async function getChannelTree(): Promise<ChannelTreeNode[]> {
  const ts3 = await getServerQuery();
  const [channels, clients] = await Promise.all([
    ts3.channelList(),
    ts3.clientList({ clientType: ClientType.Regular }),
  ]);

  return channels.map((channel) => ({
    id: channel.cid,
    parentId: channel.pid,
    name: channel.name,
    order: channel.order,
    clients: clients
      .filter((client) => client.cid === channel.cid)
      .map((client) => ({
        id: client.clid,
        nickname: client.nickname,
        talkPower: client.talkPower,
      })),
  }));
}

export async function moveClient(clientId: string, channelId: string, channelPassword?: string): Promise<void> {
  const ts3 = await getServerQuery();
  await ts3.clientMove(clientId, channelId, channelPassword);
}

export async function kickClient(
  clientId: string,
  scope: "channel" | "server",
  reason = "",
): Promise<void> {
  const ts3 = await getServerQuery();
  await ts3.clientKick(
    clientId,
    scope === "server" ? ReasonIdentifier.KICK_SERVER : ReasonIdentifier.KICK_CHANNEL,
    reason,
  );
}

export async function banClient(clientId: string, durationSeconds: number, reason = ""): Promise<void> {
  const ts3 = await getServerQuery();
  await ts3.banClient({ clid: clientId, time: durationSeconds || undefined, banreason: reason });
}
