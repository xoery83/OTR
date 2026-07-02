import { supabase } from "@/lib/supabase/client";

export type GoogleDriveHealth = {
  healthy: boolean;
  status?: string;
  needsReconnect?: boolean;
  message?: string;
  error?: string;
};

export const GOOGLE_DRIVE_RECONNECT_MESSAGE =
  "Google Drive 连接已失效，请到行程设置重新连接云盘后再上传。";

export async function checkGoogleDriveHealth(tripId: string) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error("请先登录后再检查 Google Drive。");
  }

  const response = await fetch("/api/google-drive/health", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tripId }),
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleDriveHealth;

  if (!response.ok || !payload.healthy) {
    throw new Error(
      payload.message ||
        payload.error ||
        "Google Drive 当前不可用，请到行程设置重新连接云盘后再上传。",
    );
  }

  return payload;
}
