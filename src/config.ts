import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана обязательная переменная окружения: ${name}`);
  return value;
}

const ts3Host = required("TS3_HOST");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  ts3: {
    host: ts3Host,
    queryPort: Number(process.env.TS3_QUERY_PORT ?? 10022),
    queryProtocol: (process.env.TS3_QUERY_PROTOCOL ?? "ssh") as "raw" | "ssh",
    queryUser: required("TS3_QUERY_USER"),
    queryPassword: required("TS3_QUERY_PASSWORD"),
    queryNickname: process.env.TS3_QUERY_NICKNAME ?? "WebAdminQuery",
    voiceHost: process.env.TS3_VOICE_HOST ?? ts3Host,
    voicePort: Number(process.env.TS3_VOICE_PORT ?? 9987),
    // Пароль подключения к серверу (не ServerQuery). Двойное назначение:
    // 1) отдаётся в honeybbq-клиент как serverPassword при заходе моста на TS3;
    // 2) используется как единственный пароль входа на веб-страницу (см. server.ts).
    serverPassword: required("TS3_SERVER_PASSWORD"),
    bridgeNicknamePrefix: process.env.TS3_BRIDGE_NICKNAME_PREFIX ?? "Web",
  },
};
