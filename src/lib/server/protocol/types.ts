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

// A short, colored label a program attaches to a project to communicate an
// attribute right in the review queue (e.g. "AI-flagged", "First-time", "Grant
// pending"). Rendered GitHub-style. Sidekick never interprets tags — they are
// purely informational for reviewers.
export interface ProjectTag {
  label: string;
  // Hex color ("#3b82f6" or shorthand "#39f"). Optional — Sidekick falls back to
  // a neutral gray when omitted or unparseable. Sidekick derives the pill's
  // background, text, and border from this single color.
  color?: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  demoUrl?: string;
  codeUrl: string;
  screenshotUrl?: string;
  authorId: string; // Slack ID ("U...") or HCA ID ("ident!...")
  // The author's full name as recorded by Hack Club Auth. Programs that sign
  // participants in via HCA already have this on file — send it so reviewers
  // see the HCA name on the author card alongside the Slack-resolved display
  // name. Sidekick never looks it up itself; omit if you don't have it.
  authorHcaName?: string;
  hackatimeId?: string; // Hackatime user lookup — Slack ID, HCA ID, or Hackatime numeric ID. Falls back to authorId if omitted.
  hackatimeProjectKeys: string[];
  // ISO date (YYYY-MM-DD). When set, Sidekick only counts Hackatime activity on
  // or after this date when aggregating hours — send your event's start date so
  // pre-event time on reused Hackatime projects doesn't inflate the totals.
  hackatimeStartDate?: string;
  ships: Ship[];
  // Optional colored labels shown on the review queue. Omit or send [] for none.
  tags?: ProjectTag[];
  // The project's own page on the program's site. Sidekick shows an "Open in
  // <program>" button next to "Copy JSON" when set.
  platformUrl?: string;
  metadata?: Record<string, unknown>;
}

// One choice of a "select" review field. `group` clusters options under a
// heading (options sharing a group should be sent next to each other; groups
// appear in the order they first occur). `imageUrl` is a small preview shown
// beside the label, in the menu and on the closed control.
export interface ReviewFieldOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
  imageUrl?: string;
}

export interface ReviewFieldDefinition {
  name: string;
  label: string;
  // "markdown" behaves exactly like "string" (string values on the wire) but
  // renders as a textarea with Markdown support in the review form. "select"
  // is a dropdown over `options`; its value on the wire is the chosen
  // option's `value` string.
  type: "string" | "integer" | "boolean" | "markdown" | "select";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  // Required for "select", ignored otherwise.
  options?: ReviewFieldOption[];
}

// A check the program ran itself (a pre-screen, a fraud heuristic, a linter),
// shown in the review page's "Automated checks" card next to Sidekick's own.
// Sidekick never re-runs or interprets these; they are the program's report.
export interface ProgramCheck {
  id: string;
  name: string;
  status: "pass" | "fail" | "inconclusive";
  // How much a failure matters. "warn" and "info" failures render as notices
  // rather than failures. Defaults to "fail".
  severity?: "info" | "warn" | "fail" | "critical";
  // Heading the check is listed under. Checks without one are grouped under
  // the program's name. Groups appear in the order they first occur.
  group?: string;
  // One or two sentences for the reviewer: why it failed, or what was seen.
  summary?: string;
  // A page that explains the rule (a guideline, a runbook).
  url?: string;
}

// ---------------------------------------------------------------------------
// Blocks: program-defined rich content, loosely modelled on Slack's Block Kit.
// Text fields are Markdown (raw HTML is escaped; only http(s) and mailto
// links and http(s) images are kept). Any block may be marked `isInternal`,
// which renders it with the reviewer-only styling.
// ---------------------------------------------------------------------------

export interface BlockImage {
  imageUrl: string;
  alt: string;
}

export interface BlockField {
  label: string;
  value: string; // Markdown
}

export type Block = { isInternal?: boolean } & (
  | {
      // The workhorse: an optional title, body text, a grid of label/value
      // pairs and a thumbnail beside the text.
      type: "section";
      title?: string;
      text?: string;
      fields?: BlockField[];
      accessory?: BlockImage;
    }
  | {
      type: "image";
      imageUrl: string;
      alt: string;
      title?: string;
      caption?: string; // Markdown
    }
  | {
      // A single muted line of small text and icons, for metadata.
      type: "context";
      elements: Array<{ type: "text"; text: string } | ({ type: "image" } & BlockImage)>;
    }
  | {
      type: "callout";
      tone: "info" | "success" | "warning" | "danger";
      title?: string;
      text: string;
    }
  | { type: "divider" }
);

// One step of an agent's work, in the order it happened: what it thought,
// which tools it called with what, and what came back. `input` and `output`
// may be strings or any JSON; Sidekick pretty-prints non-strings.
export type TraceStep =
  | { type: "thought"; text: string } // Markdown
  | { type: "text"; text: string } // Markdown: something the agent said, not thought
  | {
      type: "tool_call";
      name: string;
      input?: unknown;
      output?: unknown;
      isError?: boolean;
      durationMs?: number;
    };

// Who produced a `system` event: an automated reviewer, a bot, a pipeline.
export interface SystemEventSource {
  name: string;
  iconUrl?: string;
}

export type ReviewFieldValues = Record<string, string | number | boolean>;

export interface Ship {
  id: string;
  hoursSubmitted: number;
  submittedAt: string; // ISO 8601
  status: "pending" | "pending_hq" | "approved" | "rejected";
  approveFields?: ReviewFieldDefinition[];
  rejectFields?: ReviewFieldDefinition[];
  // The program's own checks for this ship, shown alongside Sidekick's. Only
  // read from the ship under review.
  checks?: ProgramCheck[];
  // Advertises that the program accepts `rewardedHoursOverride` on approvals of
  // this ship. When true, Sidekick offers reviewers an optional override of the
  // hours rewarded to the author (distinct from `hoursAssigned`, which is what
  // lands in the Unified YSWS DB).
  supportsRewardedOverride?: boolean;
}

export interface ProjectChange {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
  diffType: "text" | "url" | "image";
}

// Arbitrary program-defined data displayed on a ship event, e.g. a change
// description (public) or a reviewer note (internal). Internal fields are
// only ever shown to reviewers, never the participant.
export interface ShipDisplayField {
  label: string;
  value: string;
  isInternal?: boolean;
}

export type TimelineEvent =
  | {
      type: "ship";
      shipId: string;
      actorId: string;
      hoursSubmitted: number;
      changes?: ProjectChange[];
      displayFields?: ShipDisplayField[];
      // Rendered after displayFields.
      blocks?: Block[];
      timestamp: string;
    }
  | {
      type: "approval";
      shipId: string;
      actorId: string;
      hoursAssigned: number;
      hoursDeflated?: number;
      rewardedHoursOverride?: number;
      feedbackMessage: string;
      justification: string;
      fields?: ReviewFieldValues;
      timestamp: string;
    }
  | {
      type: "pending_approval";
      id: string;
      shipId: string;
      actorId: string;
      hoursAssigned: number;
      rewardedHoursOverride?: number;
      feedbackMessage: string;
      justification: string;
      fields?: ReviewFieldValues;
      timestamp: string;
    }
  | {
      type: "authorized_approval";
      shipId: string;
      actorId: string;
      authorizedByActorId: string;
      hoursAssigned: number;
      hoursDeflated?: number;
      rewardedHoursOverride?: number;
      feedbackMessage: string;
      justification: string;
      fields?: ReviewFieldValues;
      timestamp: string;
    }
  | {
      type: "discarded_approval";
      id: string;
      shipId: string;
      actorId: string;
      discardedByActorId: string;
      hoursAssigned: number;
      rewardedHoursOverride?: number;
      feedbackMessage: string;
      justification: string;
      fields?: ReviewFieldValues;
      timestamp: string;
    }
  | {
      type: "rejection";
      shipId: string;
      actorId: string;
      feedbackMessage: string;
      internalMessage?: string;
      fields?: ReviewFieldValues;
      timestamp: string;
    }
  | {
      type: "comment";
      actorId: string;
      message: string;
      isInternal: boolean;
      timestamp: string;
    }
  | {
      // Something a machine said about the project: an automated review, a
      // bot's analysis. Has no actorId; `source` names the machine. Never
      // editable from Sidekick.
      type: "system";
      id: string;
      shipId?: string;
      source: SystemEventSource;
      // One line completing "<source name> …", e.g. "suggested approving 4h".
      summary: string;
      // Colours the event's icon: the verdict at a glance.
      tone?: "neutral" | "success" | "warning" | "danger";
      blocks?: Block[];
      // The machine's reasoning (Markdown), collapsed behind a toggle.
      reasoning?: string;
      // The agent's steps, shown under the reasoning.
      trace?: TraceStep[];
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
  status?: "pending" | "pending_hq" | "approved" | "rejected" | "all";
  cursor?: string;
  limit?: number;
}

export interface FetchProjectDetailInput {
  projectId: string;
}

export interface FetchProjectTimelineInput {
  projectId: string;
}

// Optional action — programs that don't implement it return INVALID_ACTION and
// Sidekick hides the "Other projects" section.
export interface FetchAuthorProjectsInput {
  authorId: string; // Slack ID ("U...") or HCA ID ("ident!...")
  excludeProjectId?: string; // usually the project currently under review
}

// Optional action pair — a program advertises per-user reviewer notes by
// implementing both. INVALID_ACTION from FETCH_USER_NOTE means unsupported and
// Sidekick hides the user-note UI entirely. Notes are per-USER (they follow
// the participant across projects and reviews), which is why they are their
// own actions and not a custom review field.
export interface FetchUserNoteInput {
  userId: string; // Slack ID ("U...") or HCA ID ("ident!...")
}

export interface UpdateUserNoteInput {
  userId: string; // Slack ID ("U...") or HCA ID ("ident!...")
  note: string | null; // whole-note replacement; null/empty clears it
  editorId: string; // actor ID of the reviewer making the edit
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
        // Optional override of the hours rewarded to the author. Only sent when
        // the ship advertises `supportsRewardedOverride` and the reviewer filled
        // it in. How (and whether) the override is surfaced is up to the program.
        rewardedHoursOverride?: number;
        feedbackMessage: string;
        justification: string;
        isHq: boolean; // HQ approvals skip the pending_hq stage and finalize immediately
        fields?: ReviewFieldValues;
      }
    | {
        action: "reject";
        feedbackMessage: string;
        internalMessage?: string;
        isHq: boolean;
        fields?: ReviewFieldValues;
      }
    | {
        action: "authorize";
        hoursAssigned?: number;
        rewardedHoursOverride?: number; // carried over from the original approval, if any
        justification?: string; // Sidekick sends a canned default if the authorizer gave none
      }
    | {
        action: "deauthorize";
        message?: string; // feedback to the original reviewer; canned default if absent
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
      // Only sent when editing an approval that is still awaiting HQ
      // authorization (pending_hq). Programs must apply it so a later
      // `authorize` without hours finalizes the edited value; hour edits on
      // finalized approvals are invalid.
      hoursAssigned?: number;
      // Same pending_hq-only semantics as hoursAssigned. `null` clears a
      // previously-set override (the author is rewarded the assigned hours).
      rewardedHoursOverride?: number | null;
      fields?: ReviewFieldValues;
    }
  | {
      type: "rejection";
      feedbackMessage: string;
      internalMessage?: string;
      fields?: ReviewFieldValues;
    }
);

export interface UpdateReviewActionOutput {
  success: boolean;
}

export type FetchShopItemsInput = Record<string, never>;

export interface FetchOrdersInput {
  status?: "pending" | "fulfilled" | "cancelled" | "all";
  filterItemId?: string;
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
  // Sort hint. When true, the program asserts that `projects` is already in the
  // exact order it wants shown, and Sidekick preserves that order instead of
  // applying its own longest-waiting-first sort. The order is honored across
  // pagination (pages are concatenated in cursor order). The flag is read
  // per-status: set it on every page of a given status query for consistency.
  // Omit or send false to let Sidekick sort.
  explicitlySorted?: boolean;
}

export type FetchProjectDetailOutput = Project;

export interface FetchProjectTimelineOutput {
  events: TimelineEvent[];
}

export interface FetchAuthorProjectsOutput {
  projects: Project[];
}

export interface FetchUserNoteOutput {
  note: string | null;
}

export interface UpdateUserNoteOutput {
  success: boolean;
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
  pendingHqCount: number;
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
  | { action: "FETCH_AUTHOR_PROJECTS"; input: FetchAuthorProjectsInput }
  | { action: "FETCH_USER_NOTE"; input: FetchUserNoteInput }
  | { action: "UPDATE_USER_NOTE"; input: UpdateUserNoteInput }
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
  FETCH_AUTHOR_PROJECTS: FetchAuthorProjectsOutput;
  FETCH_USER_NOTE: FetchUserNoteOutput;
  UPDATE_USER_NOTE: UpdateUserNoteOutput;
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
