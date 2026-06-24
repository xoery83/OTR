export type MemoryEntryType = "text" | "photo" | "voice" | "location";

export type Trip = {
  id: string;
  name: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  coverImageUrl: string | null;
  createdAt: string;
  createdBy?: string | null;
};

export type TripMember = {
  id: string;
  tripId: string;
  userId: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  createdAt?: string;
};

export type MemoryEntry = {
  id: string;
  tripId: string;
  userId: string;
  type: MemoryEntryType;
  content: string;
  mediaUrl: string | null;
  locationName: string | null;
  capturedAt: string;
  createdAt: string;
  contributorName?: string;
  contributorAvatarUrl?: string | null;
};

export type DailyReport = {
  id: string;
  tripId: string;
  date: string;
  title: string;
  summary: string;
  highlights: string[];
  createdAt: string;
};

export type MediaAsset = {
  id: string;
  tripId: string;
  userId: string;
  memoryEntryId: string;
  assetType: "image" | "video" | "audio";
  storageBucket: string;
  originalFilePath: string | null;
  compressedFilePath: string | null;
  thumbnailFilePath: string | null;
  originalFileSize: number | null;
  compressedFileSize: number | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  storageTier: "standard" | "pro_original";
  isOriginalPreserved: boolean;
  retentionUntil: string | null;
  createdAt: string;
};

export type Profile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
};

export type CreateTripInput = {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
};

export type JourneyStatus = "upcoming" | "active" | "completed";

export type ItineraryEventType =
  | "flight"
  | "hotel"
  | "car"
  | "activity"
  | "meal"
  | "transport"
  | "note"
  | "other";

export type ItineraryEvent = {
  id: string;
  tripId: string;
  title: string;
  description: string | null;
  eventType: ItineraryEventType;
  locationName: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  bookingReference: string | null;
  url: string | null;
  orderIndex: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateItineraryEventInput = {
  tripId: string;
  title: string;
  description: string;
  eventType: ItineraryEventType;
  locationName: string;
  plannedStart: string;
  plannedEnd: string;
  bookingReference: string;
  url: string;
};

export type JourneyInviteRole = "member" | "admin";

export type JourneyInvite = {
  id: string;
  tripId: string;
  token: string;
  invitedEmail: string | null;
  role: JourneyInviteRole;
  createdBy: string | null;
  expiresAt: string | null;
  maxUses: number;
  usedCount: number;
  isActive: boolean;
  createdAt: string;
};

export type InviteAcceptStatus =
  | "joined"
  | "already_member"
  | "expired"
  | "invalid"
  | "full";
