import { NextResponse } from "next/server";
import { cleanupMediaCache, getDiskUsagePercent } from "@/lib/server/media-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isAuthorized(request: Request) {
  const secret = process.env.MEDIA_CACHE_CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return jsonError("Unauthorized.", 401);
  }

  try {
    const before = await getDiskUsagePercent();
    const result = await cleanupMediaCache({
      targetDiskUsagePercent: 70,
      previewRetentionDays: 90,
    });
    const after = await getDiskUsagePercent();
    return NextResponse.json({
      beforeDiskUsagePercent: before,
      afterDiskUsagePercent: after,
      deletedCount: result.deletedCount,
      host: result.host,
      previewGenerationDisabled: after >= 85,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not clean media cache.",
      500,
    );
  }
}
