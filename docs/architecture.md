# Token Poker Architecture

## Summary

Token Poker is a workshop estimation tool for comparing the economics of hand-coding a task with delegating it to an AI model. The repository has a static prototype mock and a frontend-only MVP. The architecture is deliberately shaped so the same concepts can later support multiple remote players in a shared session.

The product framing is a workshop estimation ritual. "Player" is acceptable for people participating in that ritual.

## Frontend Artifacts

The prototype mock lives at `mock/index.html`. It is a single-file artifact used to preserve the original visual direction and interaction sketch.

The frontend-only MVP lives in `app/`:

- `app/index.html`: application shell.
- `app/styles.css`: responsive layout and visual system.
- `app/app.js`: state management, rendering, persistence, and calculation helpers.
- `app/tests.html`: browser-run calculation checks.

The MVP uses plain HTML, CSS, and JavaScript. It has no build step, no backend, and no external dependencies.

Responsibilities:

- Render one active local estimation session.
- Let a facilitator set the task and hourly rate.
- Let the facilitator manage 1-6 players.
- Let players enter Fibonacci points, no-AI implementation time, model tier, and total AI tokens.
- Hide values until reveal by showing only submission status.
- Compute avoided no-AI labor value, token spend, net savings, and team summaries.
- Show the agglomeration ladder when token economics suggest the task is too small or too costly as a standalone delegation.
- Persist only the current MVP state in `localStorage` under `token-poker-mvp-v1`.
- Let pricing be edited locally and reset to the scraped defaults.

The frontend-only MVP is not responsible for real privacy or remote synchronization. It is intended for a facilitator running a shared-screen or pass-the-device workshop.

## Local Data Model

```js
SessionConfig = {
  hourlyRate: number,
  modelTiers: ModelTier[],
  tokenSplit: {
    inputShare: number,
    outputShare: number
  }
}

ModelTier = {
  id: string,
  provider: string,
  label: string,
  tier: string,
  inputPricePerMTok: number,
  cachedInputPricePerMTok?: number,
  outputPricePerMTok: number,
  character: string,
  pricingSourceUrl: string,
  pricingCheckedAt: string
}

Task = {
  title: string
}

Player = {
  id: string,
  name: string
}

Estimate = {
  playerId: string,
  fibonacciPoints: number,
  noAiHours: number,
  modelTierId: string,
  totalTokens: number
}

RevealResult = {
  playerId: string,
  fibonacciPoints: number,
  noAiHours: number,
  noAiValue: number,
  totalTokens: number,
  inputTokens: number,
  outputTokens: number,
  tokenCost: number,
  netSavings: number
}

MvpState = {
  config: SessionConfig,
  task: Task,
  players: Player[],
  estimates: Record<string, Estimate>,
  activePlayerId: string,
  phase: "estimating" | "revealed"
}
```

## Calculation Rules

- No-AI value = `noAiHours * hourlyRate`.
- Total tokens are entered per player and rounded to `50,000` increments.
- Token slider uses a logarithmic mapping from `0` to `10,000,000` tokens so low and high estimates are both reachable.
- Token spend = input MTok cost + output MTok cost using the configured input/output split.
- Default split is `30%` input and `70%` output.
- Net savings = no-AI value - token spend.
- Team summaries use min, median, and max for Fibonacci points, token cost, and net savings.
- Insight logic highlights agglomeration when low-point work has meaningful token cost or when token cost exceeds no-AI value.

## Pricing Sources

The MVP uses scraped pricing snapshots rather than generic model tiers. The current snapshots were checked on June 10, 2026.

Anthropic Claude API pricing:
- Claude Fable 5: `$10 / MTok` input, `$50 / MTok` output.
- Claude Opus 4.8: `$5 / MTok` input, `$25 / MTok` output.
- Claude Sonnet 4.6: `$3 / MTok` input, `$15 / MTok` output.
- Claude Haiku 4.5: `$1 / MTok` input, `$5 / MTok` output.

OpenAI API pricing:
- GPT-5.5: `$5 / MTok` input, `$0.50 / MTok` cached input, `$30 / MTok` output.
- GPT-5.4: `$2.50 / MTok` input, `$0.25 / MTok` cached input, `$15 / MTok` output.
- GPT-5.4 mini: `$0.75 / MTok` input, `$0.075 / MTok` cached input, `$4.50 / MTok` output.

DeepSeek Models & Pricing:
- DeepSeek-V4-Pro: `$0.435 / MTok` cache-miss input, `$0.003625 / MTok` cache-hit input, `$0.87 / MTok` output.
- DeepSeek-V4-Flash: `$0.14 / MTok` cache-miss input, `$0.0028 / MTok` cache-hit input, `$0.28 / MTok` output.

Calculator default:

- Use standard input pricing for Anthropic and OpenAI.
- Use cache-miss input pricing for DeepSeek unless the product later adds an explicit cache-hit estimate toggle.
- Show cached input prices as context only; do not apply them to v0 calculations.
- Split one total token estimate into `30%` input and `70%` output unless the facilitator edits the split.

The frontend cannot reliably scrape provider pages at runtime because of browser cross-origin restrictions and because pricing pages may render dynamically. For the frontend-only MVP, pricing is an editable, visible snapshot. A remote version should refresh pricing server-side, validate the parsed table, and stamp each model row with `pricingSourceUrl` and `pricingCheckedAt`.

## Remote Session Architecture

Remote players require a shared backend. Browser-local state is not enough because estimates must be synchronized and hidden until reveal.

Core flow:

1. Facilitator creates a session.
2. Server returns a session id and share link.
3. Players join the session from their own browsers.
4. Players submit private estimates.
5. Clients see who has submitted, but not the estimate values.
6. Facilitator reveals the session.
7. Server broadcasts revealed results to all connected clients.
8. Facilitator can start a revote or set a new task.

Suggested server records:

```js
Session = {
  id: string,
  task: Task,
  config: SessionConfig,
  phase: "setup" | "estimating" | "ready" | "revealed" | "revote",
  facilitatorPlayerId: string,
  createdAt: string,
  updatedAt: string
}

RemotePlayer = {
  id: string,
  sessionId: string,
  displayName: string,
  connectionStatus: "online" | "offline",
  joinedAt: string
}

RemoteEstimate = {
  sessionId: string,
  playerId: string,
  fibonacciPoints: number,
  noAiHours: number,
  modelTierId: string,
  totalTokens: number,
  submittedAt: string
}

SessionEvent = {
  sessionId: string,
  type: "join" | "taskChanged" | "estimateSubmitted" | "reveal" | "revote",
  actorPlayerId: string,
  createdAt: string
}
```

Privacy rule:

- Before reveal, the backend may expose player names and submission status.
- Before reveal, the backend must not expose estimate values to other players.
- After reveal, estimate values and computed results may be broadcast to the whole session.

Transport:

- Use HTTP for create session, join session, update task/config, submit estimate, reveal, and revote.
- Use WebSockets or server-sent events for live player presence, submission status, and reveal updates.
- If live transport is unavailable, polling can preserve correctness with a less polished experience.

Persistence:

- Active remote sessions should be stored server-side.
- Long-term history, accounts, team workspaces, and calibration analytics are out of scope for the first remote version.
- A later version can add session history after the core privacy and reveal flow is proven.

## API Sketch

```http
POST /sessions
GET /sessions/:sessionId
POST /sessions/:sessionId/players
PATCH /sessions/:sessionId/task
PATCH /sessions/:sessionId/config
PUT /sessions/:sessionId/players/:playerId/estimate
POST /sessions/:sessionId/reveal
POST /sessions/:sessionId/revote
GET /sessions/:sessionId/events
```

Response shaping matters more than transport choice. Pre-reveal session responses must include only submission status:

```js
{
  session: { id, task, config, phase },
  players: [{ id, displayName, connectionStatus, hasSubmitted }],
  results: null
}
```

After reveal, responses may include estimates and computed results:

```js
{
  session: { id, task, config, phase: "revealed" },
  players: [{ id, displayName, connectionStatus, hasSubmitted }],
  results: {
    playerResults: RevealResult[],
    teamSummary: { min: number, median: number, max: number },
    insight: string
  }
}
```

## Version Boundaries

Included in the frontend-only MVP:

- One local estimation session.
- Claude, GPT, and DeepSeek pricing snapshots.
- Editable local pricing.
- Fibonacci point estimates.
- Explicit total-token estimates with a log-scaled slider up to 10M.
- No-AI implementation time and avoided labor value.
- Player management for 1-6 players.
- Local calculation logic.
- Reveal state.
- Agglomeration ladder prompt.
- Browser-run calculation tests.

Excluded from the frontend-only MVP:

- Real remote players.
- Accounts and authentication.
- Backend storage.
- Live provider pricing sync.
- Long-term history.
- Export/import.
- Analytics.

The architecture leaves room for remote sessions without making the frontend-only MVP depend on a backend too early.
