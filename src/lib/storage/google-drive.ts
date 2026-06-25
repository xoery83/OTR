type GoogleDriveFile = {
  id: string;
  name: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  mimeType?: string;
  size?: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

async function createFolder(
  accessToken: string,
  name: string,
  parentFolderId?: string | null,
) {
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        parents: parentFolderId ? [parentFolderId] : undefined,
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Could not create Google Drive folder.");
  }

  return (await response.json()) as GoogleDriveFile;
}

export async function createGoogleDriveFolder(input: {
  accessToken: string;
  name: string;
  parentFolderId?: string | null;
}) {
  return createFolder(input.accessToken, input.name, input.parentFolderId);
}

function getTripDates(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) return [];

  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  while (cursor <= end && dates.length < 60) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export async function createGoogleDriveJourneyFolders(input: {
  accessToken: string;
  tripName: string;
  startDate: string | null;
  endDate: string | null;
}) {
  const rootFolder = await createFolder(input.accessToken, "Journey");
  const journeyFolder = await createFolder(
    input.accessToken,
    input.tripName,
    rootFolder.id,
  );

  const dayFolders = [];
  const dates = getTripDates(input.startDate, input.endDate);

  for (const [index, date] of dates.entries()) {
    const dayNumber = String(index + 1).padStart(2, "0");
    const folder = await createFolder(
      input.accessToken,
      `Day ${dayNumber} - ${date}`,
      journeyFolder.id,
    );
    dayFolders.push({ date, folderId: folder.id, name: folder.name });
  }

  return {
    rootFolder,
    journeyFolder,
    dayFolders,
  };
}

export async function createGoogleDriveDayFolders(input: {
  accessToken: string;
  journeyFolderId: string;
  startDate: string | null;
  endDate: string | null;
}) {
  const dayFolders = [];
  const dates = getTripDates(input.startDate, input.endDate);

  for (const [index, date] of dates.entries()) {
    const dayNumber = String(index + 1).padStart(2, "0");
    const folder = await createFolder(
      input.accessToken,
      `Day ${dayNumber} - ${date}`,
      input.journeyFolderId,
    );
    dayFolders.push({ date, folderId: folder.id, name: folder.name });
  }

  return dayFolders;
}

export async function refreshGoogleDriveAccessToken(refreshToken: string) {
  const clientId =
    process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || "Could not refresh Google token.",
    );
  }

  return payload.access_token;
}

export async function uploadOriginalPhotoToGoogleDrive(input: {
  accessToken: string;
  folderId: string;
  file: File;
  filename: string;
}) {
  const metadata = {
    name: input.filename,
    parents: [input.folderId],
  };
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.append("file", input.file, input.filename);

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: form,
    },
  );
  const payload = (await response.json()) as GoogleDriveFile & {
    error?: { message?: string };
  };

  if (!response.ok || !payload.id) {
    throw new Error(
      payload.error?.message || "Could not upload original photo to Google Drive.",
    );
  }

  return payload;
}
