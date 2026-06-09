// ============================================================================
// Sidekick Master Endpoint Protocol - Type Definitions
// ============================================================================
// All communication between Sidekick and program endpoints uses POST requests
// with JSON bodies. Authentication is via Bearer token with a shared secret.
//
// Actor identification: all actors (authors, reviewers) are identified by a
// single string — either a Slack ID ("U...") or an HCA identity ID ("ident!...").
// Sidekick resolves display names and avatars from these IDs server-side.
// ============================================================================

// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  title: string;
  description: string;
  demoUrl?: string;
  codeUrl: string;
  screenshotUrl?: string;
  authorId: string; // Slack ID ("U...") or HCA ID ("ident!...")
  hackatimeId?: string; // Hackatime user lookup — Slack ID, HCA ID, or Hackatime numeric ID. Falls back to authorId if omitted.
  hackatimeProjectKeys: string[];
  ships: Ship[];
  metadata?: Record<string, unknown>;
}

export interface Ship {
  id: string;
  hoursSubmitted: number;
  submittedAt: string; // ISO 8601
  status: "pending" | "approved" | "rejected";
}

export interface ProjectChange {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
  diffType: "text" | "url" | "image";
}

export type TimelineEvent =
  | {
      type: "ship";
      shipId: string;
      actorId: string;
      hoursSubmitted: number;
      changes?: ProjectChange[];
      timestamp: string;
    }
  | {
      type: "approval";
      shipId: string;
      actorId: string;
      hoursAssigned: number;
      hoursDeflated?: number;
      feedbackMessage: string;
      justification: string;
      timestamp: string;
    }
  | {
      type: "pending_approval";
      id: string;
      shipId: string;
      actorId: string;
      hoursAssigned: number;
      feedbackMessage: string;
      justification: string;
      timestamp: string;
    }
  | {
      type: "discarded_approval";
      id: string;
      shipId: string;
      actorId: string;
      discardedByActorId: string;
      hoursAssigned: number;
      feedbackMessage: string;
      justification: string;
      timestamp: string;
    }
  | {
      type: "rejection";
      shipId: string;
      actorId: string;
      feedbackMessage: string;
      internalMessage?: string;
      timestamp: string;
    }
  | {
      type: "comment";
      actorId: string;
      message: string;
      isInternal: boolean;
      timestamp: string;
    }
;

export interface ShopItem {
  id: string;
  name: string;
  description?: string;
  fulfillerContext?: string;
  thumbnailUrl?: string;
  unitPrice?: number;
  metadata?: Record<string, unknown>;
}

export interface Order {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userAvatarUrl?: string;
  itemId: string;
  quantity: number;
  totalPrice?: number;
  status: "pending" | "fulfilled" | "cancelled";
  reference?: string;
  adminNotes?: string;
  userNotes?: string;
  createdAt: string; // ISO 8601
  fulfilledAt?: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Action inputs
// ---------------------------------------------------------------------------

export interface FetchProjectsInput {
  status?: "pending" | "approved" | "rejected" | "all";
  cursor?: string;
  limit?: number;
}

export interface FetchProjectDetailInput {
  projectId: string;
}

export interface FetchProjectTimelineInput {
  projectId: string;
}

type SubmitReviewActionBase = {
  shipId: string;
  reviewerId: string; // Slack ID ("U...") or HCA ID ("ident!...")
};

export type SubmitReviewActionInput = SubmitReviewActionBase &
  (
    | {
        action: "approve";
        hoursAssigned: number;
        feedbackMessage: string;
        justification: string;
      }
    | {
        action: "reject";
        feedbackMessage: string;
        internalMessage?: string;
      }
    | {
        action: "comment";
        commentText: string;
      }
    | {
        action: "internal_comment";
        commentText: string;
      }
  );

export type UpdateReviewActionInput = {
  shipId: string;
  reviewerId: string;
} & (
  | {
      type: "approval";
      feedbackMessage: string;
      justification: string;
    }
  | {
      type: "rejection";
      feedbackMessage: string;
      internalMessage?: string;
    }
);

export interface UpdateReviewActionOutput {
  success: boolean;
}

export type FetchShopItemsInput = Record<string, never>;

export interface FetchOrdersInput {
  status?: "pending" | "fulfilled" | "cancelled" | "all";
  cursor?: string;
  limit?: number;
  searchUser?: string;
  sortBy?: "id" | "user" | "item" | "quantity" | "date" | "status";
  sortOrder?: "asc" | "desc";
}

export interface FetchOrderDetailInput {
  orderId: string;
}

export interface RevealOrderAddressInput {
  orderId: string;
}

export interface UpdateOrderStatusInput {
  orderId: string;
  newStatus: "pending" | "fulfilled" | "cancelled";
  reference?: string;
}

export interface UpdateOrderFieldsInput {
  orderId: string;
  reference?: string;
  adminNotes?: string;
  userNotes?: string;
}

export interface UpdateItemFieldsInput {
  itemId: string;
  fulfillerContext?: string;
}

export type GetProgramStatsInput = Record<string, never>;

// ---------------------------------------------------------------------------
// Action outputs
// ---------------------------------------------------------------------------

export interface FetchProjectsOutput {
  projects: Project[];
  nextCursor?: string;
  totalCount: number;
}

export type FetchProjectDetailOutput = Project;

export interface FetchProjectTimelineOutput {
  events: TimelineEvent[];
}

export interface SubmitReviewActionOutput {
  success: boolean;
  event: TimelineEvent;
}

export interface FetchShopItemsOutput {
  items: ShopItem[];
}

export interface FetchOrdersOutput {
  orders: Order[];
  items: Record<string, ShopItem>;
  nextCursor?: string;
  totalCount: number;
}

export interface FetchOrderDetailOutput {
  order: Order;
  item: ShopItem;
}

export interface RevealOrderAddressOutput {
  firstName: string;
  lastName: string;
  line1: string;
  line2?: string;
  city: string;
  stateProvince?: string;
  postalCode: string;
  country: string;
  phoneNumber?: string;
}

export interface UpdateOrderStatusOutput {
  success: boolean;
}

export interface UpdateOrderFieldsOutput {
  success: boolean;
}

export interface UpdateItemFieldsOutput {
  success: boolean;
}

export interface GetProgramStatsOutput {
  pendingReviewCount: number;
  pendingFulfillmentCount: number;
}

export interface HealthCheckOutput {
  ok: boolean;
  version?: string;
}

// ---------------------------------------------------------------------------
// Discriminated union request type
// ---------------------------------------------------------------------------

export type SidekickRequest =
  | { action: "FETCH_PROJECTS"; input: FetchProjectsInput }
  | { action: "FETCH_PROJECT_DETAIL"; input: FetchProjectDetailInput }
  | { action: "FETCH_PROJECT_TIMELINE"; input: FetchProjectTimelineInput }
  | { action: "SUBMIT_REVIEW_ACTION"; input: SubmitReviewActionInput }
  | { action: "UPDATE_REVIEW_ACTION"; input: UpdateReviewActionInput }
  | { action: "FETCH_SHOP_ITEMS"; input: FetchShopItemsInput }
  | { action: "FETCH_ORDERS"; input: FetchOrdersInput }
  | { action: "FETCH_ORDER_DETAIL"; input: FetchOrderDetailInput }
  | { action: "REVEAL_ORDER_ADDRESS"; input: RevealOrderAddressInput }
  | { action: "UPDATE_ORDER_STATUS"; input: UpdateOrderStatusInput }
  | { action: "UPDATE_ORDER_FIELDS"; input: UpdateOrderFieldsInput }
  | { action: "UPDATE_ITEM_FIELDS"; input: UpdateItemFieldsInput }
  | { action: "GET_PROGRAM_STATS"; input: GetProgramStatsInput }
  | { action: "HEALTH_CHECK"; input: Record<string, never> };

// ---------------------------------------------------------------------------
// Mapped response type
// ---------------------------------------------------------------------------

type ActionOutputMap = {
  FETCH_PROJECTS: FetchProjectsOutput;
  FETCH_PROJECT_DETAIL: FetchProjectDetailOutput;
  FETCH_PROJECT_TIMELINE: FetchProjectTimelineOutput;
  SUBMIT_REVIEW_ACTION: SubmitReviewActionOutput;
  UPDATE_REVIEW_ACTION: UpdateReviewActionOutput;
  FETCH_SHOP_ITEMS: FetchShopItemsOutput;
  FETCH_ORDERS: FetchOrdersOutput;
  FETCH_ORDER_DETAIL: FetchOrderDetailOutput;
  REVEAL_ORDER_ADDRESS: RevealOrderAddressOutput;
  UPDATE_ORDER_STATUS: UpdateOrderStatusOutput;
  UPDATE_ORDER_FIELDS: UpdateOrderFieldsOutput;
  UPDATE_ITEM_FIELDS: UpdateItemFieldsOutput;
  GET_PROGRAM_STATS: GetProgramStatsOutput;
  HEALTH_CHECK: HealthCheckOutput;
};

export type SidekickResponse<T extends SidekickRequest["action"]> =
  ActionOutputMap[T];
