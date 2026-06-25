import type { JourneyMember, MemoryEntry } from "@/types";

export function getMemoryStats(memories: MemoryEntry[]) {
  return {
    total: memories.length,
    photos: memories.filter((memory) => memory.type === "photo").length,
    text: memories.filter((memory) => memory.type === "text").length,
    contributors: new Set(memories.map((memory) => memory.userId).filter(Boolean))
      .size,
  };
}

export function getTodayMemoryStats(memories: MemoryEntry[], now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return getMemoryStats(
    memories.filter((memory) => memory.capturedAt.slice(0, 10) === today),
  );
}

export function getActiveJourneyMembers(members: JourneyMember[]) {
  return members.filter(
    (member) => member.role === "owner" || member.role === "group_member",
  );
}

export function getJourneyParticipantCount(members: JourneyMember[]) {
  return getActiveJourneyMembers(members).length;
}
