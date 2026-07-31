import { createVoiceSession, type VoiceSession } from "./voiceBridge.js";

const sessions = new Map<string, VoiceSession>();

export async function openVoiceSession(connectionId: string, channelName: string): Promise<VoiceSession> {
  await closeVoiceSession(connectionId);
  const session = await createVoiceSession(channelName);
  sessions.set(connectionId, session);
  return session;
}

export async function closeVoiceSession(connectionId: string): Promise<void> {
  const session = sessions.get(connectionId);
  if (!session) return;
  sessions.delete(connectionId);
  await session.close();
}

export function getVoiceSession(connectionId: string): VoiceSession | undefined {
  return sessions.get(connectionId);
}
