export type MemoryEntryType = "text" | "photo" | "voice" | "location";

export type Trip = {
  id: string;
  name: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  coverImageUrl: string | null;
  photoStorageProvider?: PhotoStorageProvider | null;
  photoStorageStatus?: PhotoStorageStatus;
  photoStorageRootFolderId?: string | null;
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

export type JourneyMemberRole = "owner" | "group_member" | "guest";

export type JourneyMemberStatus = "linked" | "unlinked" | "invite_pending";

export type JourneyMember = {
  id: string;
  tripId: string;
  userId: string | null;
  displayName: string;
  avatarUrl: string | null;
  role: JourneyMemberRole;
  status: JourneyMemberStatus;
  notes: string | null;
  inviteEmail: string | null;
  linkedAt: string | null;
  createdAt: string;
};

export type ClaimJourneyMemberStatus =
  | "claimed"
  | "already_claimed"
  | "already_has_identity"
  | "forbidden"
  | "invalid";

export type RemoveJourneyMemberStatus =
  | "removed"
  | "last_owner"
  | "forbidden"
  | "invalid";

export type MemoryEntry = {
  id: string;
  tripId: string;
  tripDayId?: string | null;
  itineraryEventId?: string | null;
  itineraryReservationId?: string | null;
  userId: string;
  type: MemoryEntryType;
  content: string;
  mediaUrl: string | null;
  mediaAssetId?: string | null;
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
  storageProvider?: PhotoStorageProvider;
  storageBucket: string;
  originalFilePath: string | null;
  compressedFilePath: string | null;
  thumbnailFilePath: string | null;
  providerFileId?: string | null;
  providerDriveId?: string | null;
  providerWebUrl?: string | null;
  providerThumbnailUrl?: string | null;
  providerOriginalReference?: string | null;
  originalFileSize: number | null;
  compressedFileSize: number | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  storageTier: "standard" | "pro_original";
  isOriginalPreserved: boolean;
  retentionUntil: string | null;
  takenAt?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  cameraModel?: string | null;
  orientation?: string | null;
  exifJson?: Record<string, unknown>;
  aiStatus?: PhotoAiStatus;
  aiMetadata?: Record<string, unknown>;
  ocrText?: string | null;
  duplicateScore?: number | null;
  blurScore?: number | null;
  sceneTags?: string[];
  indexedAt?: string | null;
  createdAt: string;
};

export type PhotoAssetWithMemory = MediaAsset & {
  memory: MemoryEntry | null;
  displayUrl?: string;
};

export type PhotoStorageProvider =
  | "supabase_legacy"
  | "google_drive"
  | "onedrive";

export type PhotoStorageStatus =
  | "not_connected"
  | "connected"
  | "disconnected"
  | "error";

export type PhotoAiStatus =
  | "pending"
  | "processing"
  | "indexed"
  | "failed"
  | "skipped";

export type JourneyStorageConnection = {
  id: string;
  tripId: string;
  provider: Exclude<PhotoStorageProvider, "supabase_legacy">;
  accountLabel: string | null;
  providerAccountId: string | null;
  providerRootFolderId: string | null;
  journeyFolderId: string | null;
  status: Exclude<PhotoStorageStatus, "not_connected">;
  metadata: Record<string, unknown>;
  connectedBy: string | null;
  connectedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type JourneyMapObjectType =
  | "live_location"
  | "memory"
  | "booking"
  | "plan_item"
  | "hotel"
  | "restaurant"
  | "parking"
  | "fuel"
  | "toilet"
  | "airport"
  | "trailhead"
  | "poi"
  | "route_point"
  | "emergency";

export type JourneyMapObjectVisibility = "private" | "journey" | "public";

export type JourneyMapObject = {
  id: string;
  journeyId: string;
  type: JourneyMapObjectType;
  sourceType: string | null;
  sourceId: string | null;
  title: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  timestamp: string | null;
  ownerUserId: string | null;
  visibility: JourneyMapObjectVisibility;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type JourneyLiveLocation = {
  journeyId: string;
  userId: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  recordedAt: string | null;
  isLiveEnabled: boolean;
  updatedAt: string;
};

export type PhotoFaceRecognitionStatus =
  | "unknown"
  | "recognized"
  | "confirmed"
  | "rejected";

export type PhotoFace = {
  id: string;
  mediaAssetId: string;
  tripId: string;
  journeyMemberId: string | null;
  boundingBox: Record<string, unknown>;
  embedding: number[] | null;
  confidence: number | null;
  qualityScore: number | null;
  recognitionStatus: PhotoFaceRecognitionStatus;
  recognizedName: string | null;
  modelName?: string | null;
  embeddingVersion?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JourneyMemberFaceEmbedding = {
  id: string;
  tripId: string;
  journeyMemberId: string;
  mediaAssetId: string | null;
  faceId: string | null;
  embedding: number[];
  qualityScore: number | null;
  source: "manual_seed" | "photo" | "confirmed_match";
  createdBy: string | null;
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
  coverImageUrl?: string | null;
  photoStorageProvider?: PhotoStorageProvider | null;
};

export type JourneyStatus = "upcoming" | "active" | "completed";

export type ItineraryEventType =
  | "flight"
  | "hotel"
  | "car"
  | "activity"
  | "shopping"
  | "meal"
  | "transport"
  | "note"
  | "other";

export type ItineraryItemStatus =
  | "planned"
  | "cancelled"
  | "completed"
  | "skipped";

export type TripDay = {
  id: string;
  tripId: string;
  dayDate: string;
  title: string | null;
  notes: string | null;
  orderIndex: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ItineraryReservationType =
  | "flight"
  | "hotel"
  | "car"
  | "ferry"
  | "tour"
  | "restaurant"
  | "other";

export type ItineraryReservation = {
  id: string;
  tripId: string;
  tripDayId: string | null;
  reservationType: ItineraryReservationType;
  title: string;
  provider: string | null;
  locationName: string | null;
  startsAt: string | null;
  endsAt: string | null;
  confirmationCode: string | null;
  url: string | null;
  sourceText: string | null;
  confidence: number | null;
  needsReview: boolean;
  status: ItineraryItemStatus;
  participants: ItineraryReservationParticipant[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ItineraryReservationParticipant = {
  id: string;
  reservationId: string;
  userId: string;
  participationStatus: ItineraryEventParticipantStatus;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
};

export type ItineraryEvent = {
  id: string;
  tripId: string;
  tripDayId: string | null;
  reservationId: string | null;
  title: string;
  description: string | null;
  eventType: ItineraryEventType;
  locationName: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  bookingReference: string | null;
  url: string | null;
  orderIndex: number;
  sourceText: string | null;
  confidence: number | null;
  needsReview: boolean;
  status: ItineraryItemStatus;
  isEstimatedTime: boolean;
  dateConfidence: number | null;
  timeConfidence: number | null;
  participantsConfidence: number | null;
  locationConfidence: number | null;
  participants: ItineraryEventParticipant[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ItineraryEventParticipantStatus =
  | "planned"
  | "confirmed"
  | "optional"
  | "not_going";

export type ItineraryEventParticipant = {
  id: string;
  eventId: string;
  userId: string;
  participationStatus: ItineraryEventParticipantStatus;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
};

export type CreateItineraryEventInput = {
  tripId: string;
  tripDayId?: string | null;
  reservationId?: string | null;
  title: string;
  description: string;
  eventType: ItineraryEventType;
  locationName: string;
  plannedStart: string;
  plannedEnd: string;
  bookingReference: string;
  url: string;
  sourceText?: string | null;
  confidence?: number | null;
  needsReview?: boolean;
  isEstimatedTime?: boolean;
  dateConfidence?: number | null;
  timeConfidence?: number | null;
  participantsConfidence?: number | null;
  locationConfidence?: number | null;
  participantUserIds?: string[];
};

export type UpdateItineraryEventInput = {
  id: string;
  tripId: string;
  title: string;
  description?: string | null;
  eventType: ItineraryEventType;
  locationName?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  bookingReference?: string | null;
  url?: string | null;
  status?: ItineraryItemStatus;
};

export type CreateItineraryReservationInput = {
  tripId: string;
  tripDayId?: string | null;
  reservationType: ItineraryReservationType;
  title: string;
  provider?: string | null;
  locationName?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  confirmationCode?: string | null;
  url?: string | null;
  sourceText?: string | null;
  confidence?: number | null;
  needsReview?: boolean;
  participantUserIds?: string[];
};

export type UpdateItineraryReservationInput = {
  id: string;
  tripId: string;
  reservationType: ItineraryReservationType;
  title: string;
  provider?: string | null;
  locationName?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  confirmationCode?: string | null;
  url?: string | null;
  status?: ItineraryItemStatus;
  participantUserIds?: string[];
  sourceText?: string | null;
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
  | "full"
  | "removed";

export type LedgerCategory =
  | "flight"
  | "hotel"
  | "car"
  | "fuel"
  | "food"
  | "ticket"
  | "shopping"
  | "transport"
  | "insurance"
  | "other";

export type LedgerAccountingMode = "stats_only" | "shared";

export type LedgerEntryStatus = "draft" | "complete" | "needs_review";

export type LedgerSplitMethod =
  | "equal"
  | "custom_amount"
  | "custom_percentage";

export type JourneyLedger = {
  id: string;
  journeyId: string;
  baseCurrency: string;
  displayCurrency: string;
  createdAt: string;
  updatedAt: string;
};

export type LedgerEntryParticipant = {
  id: string;
  ledgerEntryId: string;
  memberId: string;
  splitMethod: LedgerSplitMethod;
  shareAmount: number | null;
  sharePercentage: number | null;
  computedShareBaseAmount: number | null;
  createdAt: string;
  updatedAt: string;
  member?: JourneyMember;
};

export type LedgerEntry = {
  id: string;
  journeyId: string;
  itineraryEventId: string | null;
  itineraryReservationId: string | null;
  memoryEntryId: string | null;
  title: string;
  description: string | null;
  category: LedgerCategory;
  accountingMode: LedgerAccountingMode;
  expenseDate: string;
  startDate: string | null;
  endDate: string | null;
  originalAmount: number;
  originalCurrency: string;
  baseAmount: number;
  baseCurrency: string;
  exchangeRate: number;
  exchangeRateDate: string | null;
  exchangeRateSource: string | null;
  payerMemberId: string | null;
  addressText: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: string | null;
  status: LedgerEntryStatus;
  createdByMemberId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  payer?: JourneyMember | null;
  participants: LedgerEntryParticipant[];
};

export type LedgerMemberBalance = {
  member: JourneyMember;
  paidTotal: number;
  owedTotal: number;
  statsOnlyTotal: number;
  balance: number;
};

export type LedgerSettlementSuggestion = {
  fromMember: JourneyMember;
  toMember: JourneyMember;
  amount: number;
  currency: string;
};

export type CreateLedgerEntryInput = {
  journeyId: string;
  itineraryEventId?: string | null;
  itineraryReservationId?: string | null;
  memoryEntryId?: string | null;
  title: string;
  description?: string;
  category: LedgerCategory;
  accountingMode: LedgerAccountingMode;
  expenseDate: string;
  startDate?: string;
  endDate?: string;
  originalAmount: number;
  originalCurrency: string;
  baseCurrency: string;
  exchangeRate: number;
  payerMemberId?: string | null;
  participantMemberIds?: string[];
  addressText?: string;
};

export type UpdateLedgerEntryInput = CreateLedgerEntryInput & {
  id: string;
};
