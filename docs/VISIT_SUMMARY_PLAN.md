# Visit Summary on Patient Open: Plan

Status, 2026-11-12:
- The endpoint `POST /v1/summaries/visit` is built and tested against UAT (section 4).
- The portal popup is pushed to doctor-portal `main` (commit `4a53f1e5f`) but hidden: `VISIT_SUMMARY_ENABLED = false`.
- The service runs on port 8787.

## 1. Problem

To understand a follow-up patient, the doctor opens several screens one by one: results, previous medicines, the patient folder and allergies. They have to remember everything themselves.

## 2. Goal

When a doctor opens a **follow-up** patient in the old case sheet (`doctor-casesheet`), a summary card at the top shows, in a few seconds:

| Section | Source | Written by |
|---|---|---|
| Last visit: date, type, doctor/specialty, diagnoses | `PatientLastVisitsInfo` | Data (deterministic) |
| Allergies | `PatientLastVisitsInfo` | Data (deterministic, **never by the LLM**) |
| Medicines from the last visit(s) | `PatientLastVisitsInfo` | Data (deterministic) |
| Results since or at the last visit, panic first, then abnormal | `PatientLastVisitsInfo` (or existing lab/department tools) | Data (flags only from the HIS) |
| "What to look at": 3 to 5 short points (for example "HbA1c 8.9% (H) on 02-Oct-2026, higher than 7.8% in June") | Everything above | LLM, each point must cite its source item |

Each item links to the existing screen (results, prescription, patient folder) so the doctor can check it.

Not in scope: treatment or dosing advice, new diagnoses, or interpreting results beyond the HIS flags. The existing guardrails and prompt rules apply.

## 3. Key design decisions

### 3.1 Prefetched, one LLM call (not an agent loop)
The data the summary needs is fixed, so the model does not have to choose tools. The service:

1. calls `PatientLastVisitsInfo` (plus lab and department results if that endpoint does not return them), in parallel;
2. normalizes the response (PHI filter, compact fields), as the existing normalizers do;
3. makes **one** LLM call (`generateText` with `Output.object` and a Zod schema). The call produces only the cited `summary` sentences and `highlights` (see section 4).

Compared with the `patient-assistant` agent loop (2 to 4 LLM steps), this is faster (target p50 under 4 s), cheaper, and repeatable (temperature 0, same input gives the same output).

### 3.2 Facts are rendered from the data, the LLM only writes the highlights
Allergies, medicines, diagnoses and result flags come straight from the normalized HIS data, so the LLM cannot drop or invent an allergy. The LLM output is a list of `{ text, sourceIds[] }`. Every `sourceId` must match an item in the input. Points with unknown ids are dropped (citation check).

### 3.3 Still works without the LLM
If Gemini fails or times out, the response still contains the deterministic sections, with `highlights: []` and `highlightsStatus: "unavailable"`. The card still saves the doctor the clicks.

### 3.4 Same safety model as the other agents
- `PatientContext` comes from the request, never from the model.
- The normalizer is the PHI filter: no SSN, mobile, insurance or DOB.
- Audit line per request with `agentId: "visit-summary"`, hashed UHID, token counts and duration. The summary text itself is not logged.
- Same `DISCLAIMER`.

### 3.5 Caching (not built yet)
For now the portal popup reuses the loaded result when it is reopened for the same visit. Planned: an in-memory LRU cache keyed by `hospitalId + patientId + latest admissionId/visit date`, with a 10-minute TTL. Reopening the case sheet or switching tabs does not call Gemini again, and a new visit or result changes the key. The cache only lives in the service process, never in the browser.

## 4. API (ahh-ai-agents)

**Implemented (2026-11-11).** Code: `src/routes/summaries.ts` (route), `src/summaries/visitSummary.ts` (HIS call, one LLM call, citation check), `src/summaries/prompt.ts`, `src/his/lastVisitsNormalizer.ts` (data reduction and PHI filter). Tests: `tests/visitSummary.test.ts`.

```
POST http://localhost:8787/v1/summaries/visit
Authorization: Bearer <API_KEY>
X-User-Id: <doctor user id>
Content-Type: application/json
```

Body: the patient context only. `admissionId` is the visit open in the case sheet; it is kept and marked `isCurrent`.

```json
{ "uhid": "AHH.0001234", "patientId": "2031262", "hospitalId": "2", "admissionId": "16487" }
```

Response (200), shortened from a real UAT run:

```json
{
  "requestId": "…",
  "isFollowUp": false,
  "patient": { "age": "52 Y", "gender": "Male" },
  "visits": [{ "id": "v1", "isCurrent": true, "date": "2025-01-01 15:40", "visitType": "IP", "hospital": "…",
               "doctor": "…", "specialty": "Internal Medicine", "admissionId": "16487" }],
  "notes": [{ "id": "n1", "visitId": "v1", "date": "2026-09-10 13:41", "doctor": "…",
              "chiefComplaint": "…", "historyOfPresentIllness": "…", "examination": "…", "assessmentPlan": "…" }],
  "diagnoses": [{ "id": "dx1", "visitId": "v1", "diagnosis": "…", "icdCode": "E11.5", "type": "Secondary", "status": "Final" }],
  "medications": [{ "id": "rx1", "visitId": "v1", "name": "…", "dose": "1 Drop", "route": "…", "frequency": "Every 8 hours",
                    "startFrom": "…", "endAt": "2026-11-23 03:08", "prescribedOn": "…", "active": true }],
  "results": [{ "id": "lab1", "visitId": "v1", "kind": "lab", "date": "2026-10-23 02:12", "test": "GLUCOSE (REFLO)", "parameter": "GLUCOSE (REFLO)",
                "value": "145", "unit": "mg/dL", "normalRange": "70 - 141", "flag": "HIGH", "panic": false, "abnormal": true,
                "previousValue": "206", "previousDate": "…" }],
  "surgeries": [{ "id": "sx1", "date": "…", "name": "…", "surgeon": "…" }],
  "allergies": [{ "id": "al1", "type": "Drug", "allergen": "Penicillin" }],
  "latestVitals": { "id": "vt1", "date": "2026-10-24 07:00", "pulse": "87", "spo2": "98", "temperature": "36.6" },
  "summary": [
    { "text": "A 52-year-old male was admitted on 01-Jan-2025 to IP Internal Medicine.", "sourceIds": ["v1"] },
    { "text": "Tracheal secretion culture showed MDR Pseudomonas aeruginosa, … CRP is 11.3 mg/L, previously 159.9.", "sourceIds": ["lab13", "lab14", "lab12"] }
  ],
  "highlights": [
    { "text": "Tracheal secretion culture shows moderate growth of MDR Pseudomonas aeruginosa.", "sourceIds": ["lab13"] }
  ],
  "highlightsStatus": "ok",
  "disclaimer": "AI-generated from HIS records. Verify in the HIS before making clinical decisions.",
  "durationMs": 6569
}
```

Fields:
- `summary` (3 to 5 sentences, a clinical handover) and `highlights` (up to 5 points to check) are the only AI-written fields. Every sentence cites `sourceIds`. A sentence citing an id that is not in the data is dropped.
- `highlightsStatus` is `ok` (AI text written), `none` (no history, so no LLM call, or nothing to say) or `unavailable` (the LLM failed or timed out; the data sections are still returned).
- `isFollowUp` is true when there is a visit other than the open one. A long-stay inpatient whose only visit is the open admission has `isFollowUp: false` but still gets a summary.
- Ids are short and stable within one response: `v` visits, `n` notes, `dx` diagnoses, `rx` medicines, `lab` results (labs, then radiology and procedure reports), `sx` surgeries, `al` allergies, `vt1` vitals.
- `results[].flag`: numeric labs are flagged from the HIS reference and panic limits (`PANIC LOW`, `PANIC HIGH`, `LOW`, `HIGH`, `NORMAL`). For text results (cultures, reports) `panic` and `abnormal` come from the HIS order flag and there is no `flag`.
- `results[].visitId` links a result to its visit, matched on the row's `AdmissionID` (the API parameter is `AdmissionID`, and `Admissionid` is read too because other lists in the same payload spell it that way). It is absent when that admission is not among the kept visits; the result is still shown, never dropped over the join.

Model and limits: `SUMMARY_MODEL` (default `gemini-3.5-flash`) with thinking level "low" (the default thinking took about 15 s). The chat agents keep `MODEL` (flash-lite). The LLM timeout is 25 s, and the HIS timeout for this call is 30 s. A typical run is about 6.5 s (HIS about 2 to 4 s, LLM about 4.4 s, about 11,000 input tokens).

Errors:

| Status | `error` | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | Body fails validation (`issues` lists the fields) |
| 401 | `UNAUTHORIZED` | Missing or wrong API key |
| 404 | (Fastify) `Route POST:/v1/summaries/visit not found` | **The running ahh-ai-agents is an older copy without this route.** Deploy or copy the files listed in section 8 |
| 502 | `HIS_UNAVAILABLE` | `PatientLastVisitsInfo` failed: network, timeout, HTTP error or a non-200 `Code` |

An LLM failure is not an error status: the response is 200 with `highlightsStatus: "unavailable"`.

Why a separate route and not `/v1/agents/visit-summary/ask`: `/ask` returns free text and requires a question. Here the UI needs structured sections. The route reuses `prepareAsk`-style validation, `PatientContext`, the audit logger and the error mapping.

## 5. Implementation steps

### Phase 0: Contract
Found on 2026-11-10 in `Downloads\DoctorPortalAPI 3\DoctorPortalAPI`; it is not yet in `C:\repos\DoctorPortalAPI` `main`.
- Controller `MissingFeatureController.cs:7952`, `GET API/PatientLastVisitsInfo?PatientID&HospitalID`.
- Model `MissingFeatureM.cs:10135`, the `PatientLastVisitsInfo : Base` envelope (`Code`, `Status`, `Message`).
- DAL `MissingFeatureDAL.cs:38651`, which runs 10 stored procedures.

| Response list | Stored procedure | Useful fields | Drop (PHI or noise) |
|---|---|---|---|
| `PatientClinicalEpisodeMetricsModelDataList` (visits) | `PR_FetchPatientVisits_CCH` | VisitDate, DischargeDate, AdmissionID, PatientType, DoctorName, SpecialisationName, HospitalName, Disposition, DischargeStatus, vitals, Height, Weight, IsPregnancy, EpisodeRemarks | PatientName, RegCode, PhotoPath, DoctorRating, LMP |
| `PatientClinicalExaminationMetricsModelDataList` (notes) | `Pr_FetchPatientChiefComplaintAndExaminations_CCH` | Admissionid, VisitDate, DoctorName, Specialisation, ChiefComplaint, HistoryofPresentIllness, PhysicalExamination, AssessmentPlan, Blocked | **SSN**, PatientName, `Copied*`, audit columns |
| `PatientDiagnosisMetricsModelDataList` | `Pr_FetchPatientDiseases_CCH` | AdmissionID, DiseaseName, Code, DiagnosisType, DiagnosisStatus, Remarks, DoctorName, Blocked | **SSN**, PatientName, scoring and audit columns |
| `MedicationPrescriptionHeaderMetricsModelDataList` | `Pr_FetchPatientOrderedOrPrescribedDrugs_CCH` | Type, Admissionid, PrescriptionDate, ItemName, Dose, DoseUoM, Strength, StrengthUOM, AdmRoute, Frequency, StartFrom, EndDateTime, Remarks, Blocked, HoldStatus, DiscontinuingRemarks | IDs |
| `LabTestResultDetailMetricsModelDataList` | `PR_FetchTestResults_CCH` with `@TBL=1` | AdmissionID, OrderDate, TestName, ParameterName, Value, UOM, MinLimit, MaxLimit, IsPanic, IsAbnormal, ResultVerifiedAt | "…By" staff names |
| `RadiologyTestResultDetailMetricsModelDataList` | same, `@TBL=2` | same as lab | same as lab |
| `ProcedureTestResultDetailMetricsModelDataList` | same, `@TBL=3` | same as lab | same as lab |
| `PatientSurgeryTrackingMetricsModelDataList` | `Pr_FetchPatientAdmissionSurgery_CCH` | SurgeryDate, SurgeryName, Code, DoctorName, SurgeryType | UHID, PatientName |
| `PatientAllergyDetailsModelDataList` | `Pr_FetchPatientAllAllergies_CCH` | TypeOfallergy, AllergyName | — |
| `PatientVitalsMetricsModelDataList` | `Pr_FetchPatientvitals_CCH` | VitalSignDate, BP, Pulse, SPO2, Temperature, Respiration, Consciousness, O2FlowRate | UserName |

Notes:
- **`HospitalID` is ignored.** It is commented out in every stored procedure call, so the response covers all AHH hospitals. That is probably what we want for a summary, but each item must show its hospital.
- One call returns everything the summary needs, so no other HIS calls are required.
- Dates come as `dd-MMM-yyyy HH:mm` (`normalizeHisDate` already handles this).
- The C# code does not limit the number of rows. Whether the stored procedures return only the last N visits or the whole history is unknown, so the normalizer caps each list (for example the last 3 visits and the results of the last 90 days).
- Base URL: the existing types say the ClinicalsAPI models are derived from DoctorPortalAPI, so once this endpoint is deployed, `HIS_BASE_URL` should work unchanged. For local testing, point `HIS_BASE_URL` at `https://localhost:44350/API`.

Real response, 2026-11-10 (patient 2031262, UAT, long-stay inpatient admitted 01-Jan-2025 and still admitted):
- The API needs Basic auth (the same HIS credentials). It returned **9.7 MB in 9 s**.
- **Only the latest admission is returned** (1 episode), and here it is the admission open now. So the open admission is kept and marked `isCurrent`, not excluded.
- It returns every row of that admission: 2,544 medicine rows (1,776 blocked, 768 not blocked, 101 distinct drugs, 17 still running) and 7,736 lab rows (2,711 orders, 213 distinct tests). The normalizer keeps one row per drug (the latest prescription, active first) and the latest value per test from the most recent 30 days (with its previous value). Output: **about 26 KB, about 6,400 tokens**.
- **`IsPanic` and `IsAbnormal` are order-level.** Every row of an order has the same value (0 of 3,080 orders are mixed): 630 in-range values are flagged abnormal, and none of the 153 "panic" rows is outside its panic limits. Numeric flags are therefore computed from MinLimit, MaxLimit, PanicMin and PanicMax (as `getLabValues` does). The order flag is used only for text results such as cultures.
- The same note is copied forward (13 identical rows), so duplicates are collapsed. Labs include noise rows (REMARKS, SAMPLE, raw sensitivity XML), which are dropped.
- `DiagnosisType` is a numeric code; the name is in `DiagonosisType`. Numbers come as `1.00000` and units as `[mg/dL]`.
- End-to-end run: about 8 s (API about 6 s, Gemini about 2 s). The highlights picked the MDR Pseudomonas culture, the E. coli urine culture, the CRP drop, glucose and anaemia, all with valid citations.

Requests for the API / DB team:
- [ ] Return only what a summary needs: exclude blocked rows, keep the last 90 days of results and the last prescription per drug, and return the last 3 episodes rather than only the latest. This cuts the 9.7 MB / 9 s down a lot.
- [ ] Return per-parameter abnormal and panic flags, or confirm that the order-level flags are intended.
- [ ] Decide whether `HospitalID` should filter the data.

Remaining:
- [ ] Run it for a new patient and an OP follow-up patient.
- [ ] Merge the endpoint into `C:\repos\DoctorPortalAPI` and deploy it to the ClinicalsAPI test environment.
- [ ] Exclude rows with `Blocked = 1`, held prescriptions and discontinued prescriptions in the normalizer.

### Phase 1: HIS layer (ahh-ai-agents)
- [ ] `src/his/types.ts`: `RawLastVisitsInfoResponse` (all fields optional, PascalCase).
- [ ] `src/his/client.ts`: `fetchLastVisitsInfo(patientId, hospitalId)` on `HisApi` and `HisClient`. If it lives on a different base URL, add `HIS_PORTAL_BASE_URL` to `config.ts` and `.env.example`.
- [ ] `src/his/normalizers.ts`: `normalizeLastVisitsInfo()`. It keeps the whitelisted fields, converts dates with `normalizeHisDate`, gives every item a stable id (`dx1`, `rx1`, `al1`, `lab1`), and excludes blocked or cancelled rows.
- [ ] Tests: `tests/normalizers.test.ts` with synthetic fixtures in `tests/fixtures/his.ts` (no real patient data).

### Phase 2: Summary service
- [ ] `src/summaries/visitSummary.ts`: fetch in parallel, normalize, decide `isFollowUp`, then call `generateObject` with the highlights schema, check citations and return the result. Timeout 15 s; if the LLM fails, return the deterministic sections.
- [ ] `src/summaries/prompt.ts`: rules as in the `patient-assistant` prompt (data only, flags only from the HIS, no advice, DD-Mon-YYYY dates). At most 5 points of up to 25 words each. Mention changes against the previous visit only when both values are present.
- [ ] `src/core/summaryCache.ts`: LRU with TTL.
- [ ] `src/routes/summaries.ts`: route plus audit, registered in `app.ts`.
- [ ] Tests: route (auth, validation), LLM failure fallback, the citation check drops invented ids, an allergy is never removed, the cache is hit on the second call, and a new patient gets `isFollowUp: false` with no LLM call.
- [ ] Also add a `getLastVisitsInfo` tool to the `patient-assistant` allowlist, so the chat can answer "what did we prescribe last time?"

### Phase 3: Doctor Portal
- [ ] `AhhAiAgentsService.getVisitSummary(patient, userId, signal)`: plain `fetch` with JSON (no streaming), reusing the existing error mapping.
- [ ] New `VisitSummaryCardComponent` in `src/app/shared/ahh-ai-chat/` (declared in `SharedModule`), placed in the **old case sheet** `src/app/portal/doctor-casesheet/` (route `doctorcasesheet`), not `doctor-casesheet-new`.
  - Template: one tag, `<app-visit-summary-card [patient]="selectedView" (openTab)="…">`, directly below the `sticky_patient_info` block in `doctor-casesheet.component.html` (about line 233), so it sits under the patient banner and above the case sheet tabs.
  - `doctor-casesheet.component.ts` (8,700 lines) only passes `selectedView` (already read from sessionStorage in `ngOnInit`, line 897) and handles `openTab` by calling its existing tab/popup methods for results, prescriptions and patient folder. All fetching, state and rendering stay inside the card component, so the case sheet is not touched otherwise.
  - Do not show it when the page is opened from the anesthesia worklist or OT dashboard (`fromAnesthesiaWorklist` / `fromOtDashboard`) unless the doctors ask for it.
  - Loads in the background when the case sheet opens and never blocks the page. Shows a skeleton while loading.
  - Shown only when `isFollowUp` is true. Collapsible, and the collapsed state is remembered per doctor.
  - Allergies at the top in the existing allergy styling. Panic and abnormal results are marked.
  - Each item links to its existing tab (results, prescription, patient folder).
  - An "Ask AHH AI" button opens the existing chat for the same patient.
  - Shows the disclaimer and a 👍/👎 feedback button (Phase 4).
- [ ] Hidden unless `aiAgentsUrl` is configured (`isEnabled`). Add a per-hospital or per-doctor feature flag for the pilot.
- [ ] Cancel the request (AbortController) when the doctor leaves the case sheet or switches patient.

### Phase 4: Pilot and evaluation
- [ ] Evaluation set: 20 to 30 de-identified follow-up cases. For each case, check by hand that every highlight is supported by its cited sources, no allergy, medicine or panic result is missing, and nothing outside the data appears.
- [ ] Pilot with 3 to 5 doctors in one specialty. Track p50 and p95 latency, the share of LLM fallbacks, 👍/👎 rate, and (from portal logs) whether doctors open fewer tabs before writing the note.
- [ ] Go or no-go on: no missing allergies or panic results in the evaluation set, p95 under 6 s, and at least 70% 👍.

## 6. Before production
These are the same gaps as in the README and they apply here too:

- Replace the API key in the browser bundle with portal JWT validation or a server-side proxy.
- Send audit records to a protected store.
- Confirm that the LLM provider meets PDPL data-residency requirements. This feature sends medicines and allergies, which is more data than the chat sends for a typical question.

## 7. Open questions
1. How many rows do the `_CCH` stored procedures return: only the last visits, or the full history?
2. Should results and visits from other hospitals be included? `HospitalID` is currently ignored.
3. How is a follow-up defined: `IsNewVisit = 0`, any previous visit in the same specialty, or within N days?
4. Should it cover only the last visit, or the last visit per specialty?
5. Should the card also appear in IP pages, Bedsboard or the new case sheet later? The first release targets the old case sheet (`doctor-casesheet`) only.

## 8. Files for this feature (to deploy or share)

ahh-ai-agents is not in git yet. Any copy of the service that should serve `/v1/summaries/visit` needs these files. Without them it answers 404 "Route POST:/v1/summaries/visit not found" (seen on a peer's machine on 2026-11-12).

| File | New or changed |
|---|---|
| `src/routes/summaries.ts` | New: the route |
| `src/summaries/visitSummary.ts` | New: HIS call, LLM call, citation check |
| `src/summaries/prompt.ts` | New: LLM instructions |
| `src/his/lastVisitsNormalizer.ts` | New: data reduction and PHI filter |
| `src/his/client.ts` | Changed: `fetchLastVisitsInfo()` with a 30 s timeout |
| `src/his/types.ts` | Changed: `PatientLastVisitsInfo` raw types |
| `src/his/normalizers.ts` | Changed: exports `str`, `isTruthyFlag`, `compact`, `visitType` |
| `src/core/errors.ts` | Changed: `HisUnavailableError` (502) |
| `src/config.ts` | Changed: `SUMMARY_MODEL`; default `PORT` is 8787 |
| `src/app.ts` | Changed: registers `summaryRoutes` |
| `tests/visitSummary.test.ts`, `tests/fixtures/his.ts`, `tests/helpers.ts` | Tests and synthetic data |
| `.env.example`, `Dockerfile`, `README.md` | Port 8787, `SUMMARY_MODEL` |

`.env` (not shared; it holds secrets): `PORT=8787`, plus optionally `SUMMARY_MODEL=gemini-3.5-flash`. `HIS_BASE_URL` must be a ClinicalsAPI where `PatientLastVisitsInfo` is deployed (`https://his.alhammadi.med.sa/ClinicalsAPiT/API` has it).

Check after deploying: `npm test` passes (107 tests), `GET /health` returns `{"status":"ok"}`, and a summary request logs `"agentId":"visit-summary"`.
