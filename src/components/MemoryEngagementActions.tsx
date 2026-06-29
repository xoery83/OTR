"use client";

import { useEffect, useState } from "react";
import {
  incrementMemoryLike,
  toggleMemoryFavorite,
  type MemoryEngagement,
} from "@/lib/supabase/memories";
import type { MemoryEntry } from "@/types";

type MemoryEngagementActionsProps = {
  memory: MemoryEntry;
  onChange?: (memoryId: string, engagement: MemoryEngagement) => void;
  compact?: boolean;
  className?: string;
};

function engagementFromMemory(memory: MemoryEntry): MemoryEngagement {
  return {
    likeCount: memory.likeCount ?? 0,
    favoriteCount: memory.favoriteCount ?? 0,
    myLikeCount: memory.myLikeCount ?? 0,
    isFavorited: memory.isFavorited ?? false,
  };
}

export function MemoryEngagementActions({
  memory,
  onChange,
  compact = false,
  className = "",
}: MemoryEngagementActionsProps) {
  const [engagement, setEngagement] = useState(() =>
    engagementFromMemory(memory),
  );
  const [workingAction, setWorkingAction] = useState<"like" | "favorite" | null>(
    null,
  );

  useEffect(() => {
    setEngagement(engagementFromMemory(memory));
  }, [
    memory.id,
    memory.likeCount,
    memory.favoriteCount,
    memory.myLikeCount,
    memory.isFavorited,
  ]);

  function applyEngagement(next: MemoryEngagement) {
    setEngagement(next);
    onChange?.(memory.id, next);
  }

  async function handleLike() {
    if (engagement.myLikeCount >= 5 || workingAction) return;

    setWorkingAction("like");
    try {
      applyEngagement(await incrementMemoryLike(memory.id));
    } finally {
      setWorkingAction(null);
    }
  }

  async function handleFavorite() {
    if (workingAction) return;

    setWorkingAction("favorite");
    try {
      applyEngagement(
        await toggleMemoryFavorite(memory.id, !engagement.isFavorited),
      );
    } finally {
      setWorkingAction(null);
    }
  }

  const buttonClass = compact
    ? "gap-1 px-2 py-1 text-[11px]"
    : "gap-1.5 px-2.5 py-1.5 text-xs";

  return (
    <div
      className={`flex shrink-0 items-center gap-1 ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={handleLike}
        disabled={workingAction !== null || engagement.myLikeCount >= 5}
        className={`inline-flex items-center rounded-full font-black transition ${
          engagement.myLikeCount > 0
            ? "bg-rose-50 text-rose-700"
            : "bg-stone-100 text-stone-600 hover:bg-rose-50 hover:text-rose-700"
        } ${buttonClass} disabled:cursor-not-allowed disabled:opacity-60`}
        title={
          engagement.myLikeCount >= 5
            ? "每个人最多点赞 5 次"
            : `点赞，已点 ${engagement.myLikeCount} 次`
        }
        aria-label="点赞"
      >
        <span aria-hidden="true">{engagement.myLikeCount > 0 ? "♥" : "♡"}</span>
        <span>{engagement.likeCount}</span>
      </button>

      <button
        type="button"
        onClick={handleFavorite}
        disabled={workingAction !== null}
        className={`inline-flex items-center rounded-full font-black transition ${
          engagement.isFavorited
            ? "bg-amber-50 text-amber-800"
            : "bg-stone-100 text-stone-600 hover:bg-amber-50 hover:text-amber-800"
        } ${buttonClass} disabled:cursor-not-allowed disabled:opacity-60`}
        title={engagement.isFavorited ? "取消收藏" : "收藏"}
        aria-label={engagement.isFavorited ? "取消收藏" : "收藏"}
      >
        <span aria-hidden="true">{engagement.isFavorited ? "★" : "☆"}</span>
        <span>{engagement.favoriteCount}</span>
      </button>
    </div>
  );
}
