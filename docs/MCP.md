# Sidekick's MCP server

Sidekick speaks the Model Context Protocol at `POST /mcp`, so an agent such as Claude Code can review beside a person: it reads what the review page reads, does the legwork, asks its reviewer about anything it cannot check, and, once its reviewer says so, acts on the review as them: approves, rejects or comments, and for HQ authorizes or sends back approvals awaiting HQ. It can also leave a drafted verdict for the reviewer to load and submit themselves.

## Connecting

1. Open **Agent access** from the account menu (`/account/agents`) and create a token. It is shown once.
2. Add the server to Claude Code with the command the page shows:

   ```sh
   claude mcp add --transport http sidekick https://<sidekick>/mcp --header "Authorization: Bearer <token>" -s user
   ```

Any MCP client that can send a Bearer header works the same way.

## Auth

- A token (`McpToken`) belongs to one user and acts as them, with exactly their program permissions: every tool runs the same `requirePermission` check as the page it mirrors, on every call. Only the SHA-256 digest is stored, with the last four characters as a hint.
- Tokens last 90 days; a user may hold 5 live ones. Revoking keeps the row.
- Write tools act as the token's owner: the program receives their reviewer id, the audit log records them as the actor (with `via: 'mcp'` and the `tokenId` in the metadata), and they can do exactly what that person can on the review page. Asking the person before each write is the review skill's job; the server does not.
- Any refusal is a bare 401, whatever the reason. Responses carry `Cache-Control: no-store`.

## Transport

Streamable HTTP, stateless, JSON responses (`WebStandardStreamableHTTPServerTransport` with no session id): every POST gets a fresh server bound to the token's owner. `GET` and `DELETE` answer 405.

## Tools

The server is data only: answers describe and never advise (no next steps, no questions to ask, no reading of what a pattern means). How to review is the review skill's job.

| Tool                       | Permission                                                                              | What it answers                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_programs`            | any membership                                                                          | Programs, pending counts, what the caller may do in each                                                                                                                                                                                                                                                                                                                                                       |
| `list_review_queue`        | `canViewReviews`                                                                        | A queue, one short row per project, oldest first unless the program sorts: `pending` (first reviews), `pending_hq` (as the program reports it) or `awaiting_hq` (every approval awaiting HQ authorization, including approvals Sidekick holds, with who approved and the hours); with `canViewHeartbeats` each row has its fraud-review verdict, and `fraud_review` (`clean`, `skipped`, `none`) filters on it |
| `get_project`              | `canViewReviews`                                                                        | The case file: claim, project, author and their other projects, Unified YSWS DB matches, Sidekick's and the program's checks, Hackatime headline and fraud-review verdict (with `canViewHeartbeats`), Lapse, history in brief, the caller's draft                                                                                                                                                              |
| `get_timeline`             | `canViewReviews`                                                                        | Every event, clipped; `event: <index>` for one in full, including a system event's reasoning and trace (Crescent's autoreview arrives this way)                                                                                                                                                                                                                                                                |
| `list_past_reviews`        | `canViewReviews`                                                                        | Projects the program already approved or rejected, newest first, with each decision as written (hours, feedback, justification); filterable by text, status and `by_me`                                                                                                                                                                                                                                        |
| `get_hackatime_overview`   | `canViewHeartbeats`                                                                     | Hours a day as a PNG bar chart (ai coding, commits, fraud-flagged days marked) plus the few numbers that say where to look                                                                                                                                                                                                                                                                                     |
| `get_hackatime_day`        | `canViewHeartbeats`                                                                     | One day (or an `HH:MM` window) as text and a PNG scatter plot of line number, file length and cursor column over time; `rows` adds raw heartbeats for a window of at most 300                                                                                                                                                                                                                                  |
| `draft_review`             | `canCreateReviews`                                                                      | Saves a drafted approval or rejection (`ReviewDraft`) for the caller, for ships awaiting a first review; audit-logged as `mcp_draft_review`                                                                                                                                                                                                                                                                    |
| `submit_review`            | `canCreateReviews`                                                                      | The review form on the pending ship: `approve`, `reject`, `comment` or `internal_comment`. Approvals by members without `canAuthorizeReviews`, or routed to fraud review, are held in Sidekick (or parked by the program, when it holds its own approvals); HQ approvals go to the program with `isHq`. Refuses approvals and rejections while an approval awaits HQ, and hours over the claim                 |
| `authorize_approval`       | `canViewReviews` plus `canAuthorizeReviews` (`canReviewFraudQueue` for the fraud queue) | The review page's Authorize on the approval awaiting HQ, after saving any edited hours, feedback, justification or rewarded hours override; a member routed to fraud review sends it to the fraud queue instead                                                                                                                                                                                                |
| `send_back_approval`       | as `authorize_approval`                                                                 | The review page's Deny: deauthorizes an upstream `pending_hq` approval with `message` for its reviewer, or discards an approval only Sidekick holds (the message goes nowhere)                                                                                                                                                                                                                                 |
| `reject_awaiting_approval` | both of the above                                                                       | Deny, then reject from the review form, in one call; the rejection is validated before the send-back                                                                                                                                                                                                                                                                                                           |

Repositories are not wrapped: the agent clones them and reads the code and history with its own tools. GitHub is read only to run Sidekick's own checks for the case file and to mark commit times on the Hackatime charts.

### Why pictures

Reviewers spot scripted or idle time by looking at heartbeats, not by reading them: a person's line numbers and cursor columns scatter, an autotyper draws a straight line, a keep-alive draws a flat one. A model asked to find that shape in a few thousand numbers misses it but reads it off a chart, so the Hackatime tools answer with a summary (`mcp/heartbeats.ts`, kept in step with Crescent's autoreviewer so both agents describe a day alike) and a PNG rendered from SVG with resvg (`mcp/charts.ts`). The day chart uses the review page's series and colours, so the agent and its reviewer talk about the same picture. The production image installs `font-dejavu` for the chart text.

### Shapes

Every answer is capped at 48,000 characters; past it the tool returns an error asking for a narrower request. Long text is clipped with a note of how much was cut. People appear by their Slack display name; real names, emails and addresses never appear. Approvals held in the fraud queue stay hidden from anyone the review page hides them from.

## Fraud review

The Fraud Review page (`/program/<id>/fraud-review`, `canViewHeartbeats`) is a pass over the pending projects that looks at their Hackatime data alone. A reviewer marks a ship's heartbeats **clean** or **skips** it, with an optional note; the verdict is stored per ship (`FraudReview`), audit-logged as `fraud_review_clean`, `fraud_review_skipped` or `fraud_review_cleared`, and shown as a badge on the review page.

- **Clean** means no fraud tooling inflated the time: no autotyper, keep-alive or scripted heartbeats, no faked Lapse.
- It does **not** mean the hours need no deflation. A clean ship may still have the wrong Hackatime project selected, track unrelated files, or include ai coding or idle time.
- **Skipped** means the reviewer left it for later or for someone else; it counts as not reviewed.
- A verdict belongs to the ship it was made on. After a re-ship, the old one is reported as being for an earlier ship (`forPendingShip: false` in `get_project`, `fraudReviewEarlierShip` in `list_review_queue`), never as current.

The MCP reads the verdict (`fraudReview` in `get_project` and in `list_review_queue` rows, only for callers with `canViewHeartbeats`) and never sets it: marking heartbeats clean is a person's call.

## Hackatime snapshots

A reviewer's agent attaches a screenshot of each project's Hackatime data, exactly as the review page shows it, to its replies. Sidekick serves that section alone, without the app shell, at `/program/<programId>/review/<projectId>/hackatime` (`?date=YYYY-MM-DD`, `?tab=graph|breakdown|files`, `?width=`), and marks it `data-ready="true"` once data and charts have rendered. It needs `canViewHeartbeats`.

A local capture client in the review skill opens that page in the reviewer's own headless Chrome and saves a PNG. It authenticates with the same personal token: `hooks.server.ts` accepts an `Authorization: Bearer sk_mcp_...` header in place of a session only for GET requests to the routes in `TOKEN_GET_ROUTES` (`mcp/tokens.ts`): the export page and the three read-only Hackatime APIs it fetches. Every other page, form action and API still requires a session, and token answers carry `Cache-Control: no-store`. The token can already read the same heartbeats through `get_hackatime_day`, so this grants nothing new.

## Drafts

`draft_review` stores one draft per reviewer and ship, and only for a ship awaiting a first review: a ship whose approval is awaiting HQ is authorized, edited or sent back instead. The review page shows the caller's own draft above the form, with **Load into form** (which fills the form through `ReviewActionPanel`'s `prefill`) and **Discard**. A draft sends nothing to the program; submitting an approval or rejection, on the page or with `submit_review`, deletes it.

## Acting on reviews

The write tools never reimplement a review action: the review page's `review` form action, the authorize endpoint (`/api/programs/<id>/review/authorize`: POST authorize, PATCH edit, DELETE deny) and the MCP all call the same functions in `$lib/server/review-actions.ts`, with the same permission checks, upstream calls and audit rows (`review_<action>`, `review_pending_approve`, `review_authorize`, `review_send_to_fraud_queue`, `review_discard_pending`). The MCP layer (`mcp/actions.ts`) only picks what the page would show (the latest pending ship and the approval awaiting HQ on it, `hq:<shipId>` for one the program holds as `pending_hq`) and says what happened, with the review URL.

Rules the page's form enforces in the browser are enforced on the server for both callers: positive hours, feedback and justification on an approval, feedback on a rejection, the ship's required custom fields (values coerced to the field's type, unknown names refused), a rewarded hours override only where the ship accepts one, and no new approval or rejection while an approval awaits HQ or fraud review. The page only warns when hours exceed what is left of the claim; the MCP refuses hours above the hours claimed for the ship.

## The review skill

How an agent should review (the rules, when to ask, how to write a justification) lives in a Claude Code skill distributed to HQ reviewers, not in this repository. The server's own `instructions` only describe what the server is: the data it serves, which actions it takes as the token's owner, and who wrote the text it returns.
