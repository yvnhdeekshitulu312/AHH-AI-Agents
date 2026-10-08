# ahh-ai-agents

A microservice that hosts AHH's clinical AI agents for the Doctor Portal.
The first agent is **`patient-history`**. It answers doctors' questions about the selected patient's visits, diagnoses and profile by calling the HIS ClinicalsAPI.

- Plan and architecture: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- HIS response shapes: [`docs/HIS_API_RESPONSES.md`](docs/HIS_API_RESPONSES.md)

## Quick start

```bash
npm install
cp .env.example .env     # fill in HIS credentials, Gemini key, API_KEY, AUDIT_HASH_SECRET
npm run dev              # http://localhost:8080
```

| Script | Purpose |
|---|---|
| `npm run dev` | Run with auto-reload |
| `npm test` | Unit and API tests (no network; HIS and LLM are mocked) |
| `npm run typecheck` | TypeScript check |
| `npm run build` / `npm start` | Production build / run |

Requires Node.js 20.11 or later (the Docker image uses Node 22).

## API

### `POST /v1/agents/{agentId}/ask`

```bash
curl -X POST http://localhost:8080/v1/agents/patient-history/ask \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-User-Id: <doctor user id>" \
  -H "Content-Type: application/json" \
  -d '{ "question": "When was the last visit and why?", "uhid": "AHH.0001234", "patientId": "123456", "hospitalId": "3" }'
```

```json
{
  "requestId": "…",
  "agentId": "patient-history",
  "answer": "The last visit was on 12-Sep-2026 to the Emergency Department (Dr. B, Internal Medicine) for acute bronchitis (J20.9).",
  "disclaimer": "AI-generated from HIS records. Verify in the HIS before making clinical decisions.",
  "toolsUsed": ["getVisits", "getDiagnoses"],
  "durationMs": 3120
}
```

| Status | Meaning |
|---|---|
| 400 | Invalid body (`INVALID_REQUEST`) or question blocked by a guardrail (`GUARDRAIL_BLOCKED`) |
| 401 | Missing or invalid API key |
| 404 | Unknown agent |
| 502 | LLM provider unavailable |
| 504 | Agent timed out (per-agent limit: 30 s for `patient-history`, 45 s for `patient-assistant`) |

Other endpoints: `GET /health` (no auth) and `GET /v1/agents` (lists agents).

### `POST /v1/agents/{agentId}/ask/stream` (used by AHH AI Chat)

Same request body and headers. Validation and guardrail failures return the normal JSON errors above; otherwise the response is Server-Sent Events:

| Event | Data | When |
|---|---|---|
| `status` | `{ "tool": "getLabResults", "label": "Checking lab results" }` | A tool starts |
| `delta` | `{ "text": "…" }` | Answer text as the model writes it (capped at the agent's output limit) |
| `done` | Same body as the JSON endpoint | Final answer after the output guardrail; show this one |
| `error` | `{ "error": "LLM_UNAVAILABLE", "message": "…", "requestId": "…" }` | Failure after the stream started |

If the client disconnects, the agent run (Gemini and HIS calls) is cancelled.

## How it works

```
request → auth → validate body → PatientContext (from request, never from the LLM)
        → input guardrail → agent loop (Gemini + allowlisted tools, max 5 steps)
        → output guardrail → audit log → response
```

- **Agents**: `patient-assistant` (used by AHH AI Chat: profile, visits, diagnoses, lab results + values, radiology/cardiology/neurology/dental results) and `patient-history` (history only).
- **Tools** (`src/tools/`) read the patient only from `PatientContext`. Model-supplied ids are ignored; lab values are looked up only from the patient's own HIS result rows.
- **Normalizers** (`src/his/normalizers.ts`) reduce HIS payloads to compact fields and act as the PHI filter. SSN, mobile, insurance, DOB and HTML blobs never reach the model. Blocked diagnoses are excluded.
- **HIS failures** inside a tool are turned into `{ error }` results, so the agent can say "data could not be retrieved" instead of failing the request.
- **Audit**: one structured log line per request (`audit: true`) with agent, user, hashed UHID, question, tools used, tokens and duration. The answer is not logged.

## Project layout

```
src/
  server.ts, app.ts, config.ts
  routes/agents.ts           # /v1/agents endpoints
  core/                      # types, agent registry, generic agent loop, errors
  llm/provider.ts            # model factory (swap provider here)
  his/                       # ClinicalsAPI client, raw types, normalizers
  tools/                     # shared tool library
  guardrails/                # input and output checks
  audit/logger.ts
  agents/patient-history/    # agent definition + system prompt
tests/                       # vitest, with synthetic HIS fixtures
```

## Adding things

**A new tool**
1. Add a raw type and a normalizer in `src/his/` (keep only the fields the model needs).
2. Create `src/tools/<name>.ts` as a factory `(deps) => tool({...})`. Read the patient from `deps.ctx` only.
3. Register it in `src/tools/index.ts`.

**A new agent**
1. Create `src/agents/<agent-id>/agent.ts` and `prompt.ts` (prompt, tool allowlist, limits).
2. Register it in `src/core/registry.ts`. It is then served at `/v1/agents/<agent-id>/ask`.

## Before production
- Verify the normalizers against one real test-patient response per HIS API (see the checklist in `docs/HIS_API_RESPONSES.md`).
- Replace the shared API key and `X-User-Id` header with portal JWT validation.
- Send `audit: true` log records to a protected store.
- Confirm the LLM provider meets data-residency (PDPL) requirements.
