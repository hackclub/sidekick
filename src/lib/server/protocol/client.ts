import { createLogger } from "../logger.js";
import type {
  SidekickRequest,
  SidekickResponse,
  FetchProjectsInput,
  FetchProjectDetailInput,
  FetchProjectTimelineInput,
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

  constructor(status: number, body: string) {
    super(`Protocol error ${status}: ${body}`);
    this.name = "ProtocolError";
    this.status = status;
    this.body = body;
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
        log.error("RPC protocol error", new ProtocolError(response.status, body), {
          action,
          status: response.status,
          body: body.slice(0, 200),
        });
        throw new ProtocolError(response.status, body);
      }

      timer.end({ action, status: response.status });
      return (await response.json()) as SidekickResponse<A>;
    } catch (err) {
      if (err instanceof ProtocolError) throw err;
      if (controller.signal.aborted) {
        log.error("RPC call aborted", err, { action });
      } else {
        log.error("RPC call failed", err, { action });
      }
      throw err;
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
