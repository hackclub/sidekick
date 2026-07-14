import { createLogger } from "../logger.js";
import type {
  SidekickRequest,
  SidekickResponse,
  FetchProjectsInput,
  FetchProjectDetailInput,
  FetchProjectTimelineInput,
  FetchAuthorProjectsInput,
  FetchUserNoteInput,
  UpdateUserNoteInput,
  SubmitReviewActionInput,
  UpdateReviewActionInput,
  FetchShopItemsInput,
  FetchOrdersInput,
  FetchOrderDetailInput,
  RevealOrderAddressInput,
  UpdateOrderStatusInput,
  UpdateOrderFieldsInput,
  UpdateItemFieldsInput,
  GetProgramStatsInput,
} from "./types";

const log = createLogger("protocol");

export class ProtocolError extends Error {
  status: number;
  body: string;
  action?: string;

  constructor(status: number, body: string, action?: string) {
    super(`Protocol error ${status}: ${body}`);
    this.name = "ProtocolError";
    this.status = status;
    this.body = body;
    this.action = action;
  }

  // The machine-readable `error` code from the endpoint's JSON error body, if any.
  get errorCode(): string | null {
    try {
      const parsed = JSON.parse(this.body);
      return typeof parsed.error === "string" ? parsed.error : null;
    } catch {
      return null;
    }
  }

  // Human-readable one-liner for surfacing to users: prefers the endpoint's JSON
  // `message`, then its `error` code, then the (truncated) raw body.
  get displayMessage(): string {
    let detail: string;
    try {
      const parsed = JSON.parse(this.body);
      detail = typeof parsed.message === "string" && parsed.message
        ? parsed.message
        : (this.errorCode ?? this.body);
    } catch {
      detail = this.body;
    }
    detail = detail.trim() || "empty response body";
    if (detail.length > 300) detail = `${detail.slice(0, 300)}…`;
    return `${this.action ?? "request"} returned HTTP ${this.status}: ${detail}`;
  }
}

// Transport-level failure — the master endpoint never returned an HTTP response
// (timeout, DNS failure, refused connection, TLS error, …).
export class ProtocolTransportError extends Error {
  action: string;

  constructor(action: string, detail: string, cause?: unknown) {
    super(`${action} request to the master endpoint failed: ${detail}`, { cause });
    this.name = "ProtocolTransportError";
    this.action = action;
  }
}

// Digs the useful part out of a Node fetch failure: undici buries the reason
// (ECONNREFUSED, ENOTFOUND, TLS errors, …) in `cause`, often with an empty
// top-level message.
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause as { code?: string; message?: string } | undefined;
  if (cause?.message && cause.message.trim()) {
    return cause.code && !cause.message.includes(cause.code)
      ? `${cause.code} — ${cause.message}`
      : cause.message;
  }
  if (cause?.code) return cause.code;
  return err.message;
}

// An address exists (or may exist) but the endpoint can't retrieve it right now —
// e.g. Beest returns 503 when its HCA tokens are expired. Distinct from 404 (no
// address on file).
export function isAddressUnavailable(e: ProtocolError): boolean {
  return e.status === 503 || e.errorCode === "ADDRESS_UNAVAILABLE";
}

export class ProtocolClient {
  private masterEndpoint: string;
  private secretKey: string;

  constructor(masterEndpoint: string, secretKey: string) {
    this.masterEndpoint = masterEndpoint;
    this.secretKey = secretKey;
  }

  private async call<A extends SidekickRequest["action"]>(
    action: A,
    input: Extract<SidekickRequest, { action: A }>["input"]
  ): Promise<SidekickResponse<A>> {
    log.debug("RPC call", { action, inputKeys: Object.keys(input as Record<string, unknown>) });
    const timer = log.time(`RPC ${action}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      log.warn("RPC call timed out", { action });
      controller.abort();
    }, 30_000);

    try {
      const response = await fetch(this.masterEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.secretKey}`,
        },
        body: JSON.stringify({ action, input }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        const protocolError = new ProtocolError(response.status, body, action);
        log.error("RPC protocol error", protocolError, {
          action,
          status: response.status,
          body: body.slice(0, 200),
        });
        throw protocolError;
      }

      timer.end({ action, status: response.status });
      return (await response.json()) as SidekickResponse<A>;
    } catch (err) {
      if (err instanceof ProtocolError) throw err;
      if (controller.signal.aborted) {
        log.error("RPC call aborted", err, { action });
        throw new ProtocolTransportError(action, "timed out after 30 seconds", err);
      }
      log.error("RPC call failed", err, { action });
      throw new ProtocolTransportError(action, describeFetchError(err), err);
    } finally {
      clearTimeout(timeout);
    }
  }

  fetchProjects(input: FetchProjectsInput) {
    return this.call("FETCH_PROJECTS", input);
  }

  fetchProjectDetail(input: FetchProjectDetailInput) {
    return this.call("FETCH_PROJECT_DETAIL", input);
  }

  fetchProjectTimeline(input: FetchProjectTimelineInput) {
    return this.call("FETCH_PROJECT_TIMELINE", input);
  }

  fetchAuthorProjects(input: FetchAuthorProjectsInput) {
    return this.call("FETCH_AUTHOR_PROJECTS", input);
  }

  fetchUserNote(input: FetchUserNoteInput) {
    return this.call("FETCH_USER_NOTE", input);
  }

  updateUserNote(input: UpdateUserNoteInput) {
    return this.call("UPDATE_USER_NOTE", input);
  }

  submitReviewAction(input: SubmitReviewActionInput) {
    return this.call("SUBMIT_REVIEW_ACTION", input);
  }

  updateReviewAction(input: UpdateReviewActionInput) {
    return this.call("UPDATE_REVIEW_ACTION", input);
  }

  fetchShopItems(input: FetchShopItemsInput) {
    return this.call("FETCH_SHOP_ITEMS", input);
  }

  fetchOrders(input: FetchOrdersInput) {
    return this.call("FETCH_ORDERS", input);
  }

  fetchOrderDetail(input: FetchOrderDetailInput) {
    return this.call("FETCH_ORDER_DETAIL", input);
  }

  revealOrderAddress(input: RevealOrderAddressInput) {
    return this.call("REVEAL_ORDER_ADDRESS", input);
  }

  updateOrderStatus(input: UpdateOrderStatusInput) {
    return this.call("UPDATE_ORDER_STATUS", input);
  }

  updateOrderFields(input: UpdateOrderFieldsInput) {
    return this.call("UPDATE_ORDER_FIELDS", input);
  }

  updateItemFields(input: UpdateItemFieldsInput) {
    return this.call("UPDATE_ITEM_FIELDS", input);
  }

  getProgramStats(input: GetProgramStatsInput) {
    return this.call("GET_PROGRAM_STATS", input);
  }

  healthCheck() {
    return this.call("HEALTH_CHECK", {});
  }
}
