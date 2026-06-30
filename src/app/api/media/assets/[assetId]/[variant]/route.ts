import { NextResponse } from "next/server";
import {
  getOrGenerateMediaVariant,
  type MediaVariantType,
} from "@/lib/server/media-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

function isVariant(value: string): value is MediaVariantType {
  return value === "thumbnail" || value === "preview";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string; variant: string }> },
) {
  const params = await context.params;
  if (!params.assetId || !isVariant(params.variant)) {
    return jsonError("Invalid media variant.", 400);
  }

  try {
    const result = await getOrGenerateMediaVariant({
      mediaAssetId: params.assetId,
      variantType: params.variant,
    });

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": result.row.mime_type || "image/webp",
        "Content-Length": String(result.buffer.length),
        "Cache-Control":
          params.variant === "thumbnail"
            ? "public, max-age=31536000, immutable"
            : "public, max-age=86400, stale-while-revalidate=604800",
        "X-OTR-Media-Variant": params.variant,
        "X-OTR-Disk-Usage": String(result.diskUsage),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load media variant.";
    const isHighDiskWarning =
      params.variant === "preview" && message.toLowerCase().includes("disk usage");
    return jsonError(message, isHighDiskWarning ? 503 : 404);
  }
}
