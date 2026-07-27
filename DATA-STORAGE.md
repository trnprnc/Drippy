# Drippy data storage — design

Status: decided 2026-07-21 (decisions at the foot). Phase 1 is built:
the device upload contract and ledger (sync.js), the ingest service
(server/) and the welcome-sheet opt-in. Sync stays off by default; the
pill and its local history are unaffected either way.

## Why store data at all

Drippy Commercial sells organisation-wide transparency on AI use (energy,
water, carbon, spend, privacy posture), built from the same meters each
employee already sees. Consumers get the same storage as an opt-in: their
history survives the device, and several devices merge into one picture.
Both require usage records to leave the device. This document defines
exactly which records, in what shape, who can see them at which
resolution, and how the same transparency Drippy applies to AI is applied
to Drippy itself.

## Principles (inherited, non-negotiable)

1. **Verdicts, not content.** Unchanged from PRIVACY.md. No prompt text,
   no clipboard text, no composer text exists anywhere in the pipeline,
   so none can be stored. The cloud schema has no column that could hold
   content.
2. **Employee-first.** The employee sees everything about themselves; the
   organisation sees aggregates. Drippy is never a surveillance tool, and
   the line is structural (enforced by schema and query layer), not
   policy.
3. **Drippy meters himself.** Every record that leaves the device is
   itself recorded and inspectable by the user: what was sent, when,
   where, and under which policy. Transparency about the transparency
   layer.
4. **The device keeps working alone.** Local history remains the source
   of truth for the pill, hover and trends. Sync is additive; offline
   changes nothing.
5. **Neutral numbers.** Drippy never communicates that usage is good or
   bad; it provides the numbers and their provenance. An environmental
   organisation and an AI-first startup will read the same dashboard in
   opposite directions, and both are right. No leaderboards, no
   red/green judgement colouring, no targets unless an org configures
   its own.

## What is stored (and what never is)

**Store drivers and context; derive figures.** Records carry the inputs
that produced a number (tokens by class, bytes, model, factor version),
not just the number. The cloud derives Wh, water, CO₂e and $ from
versioned factor tables, so history is restated when factors improve,
every figure is reproducible for an auditor, and Phase 3 reconciliation
against provider APIs is a join, not a migration. The device's own
locally derived figures ride along as a cross-check; a discrepancy
beyond rounding is a data-quality signal, surfaced, never hidden.

| Record | Fields | Notes |
| --- | --- | --- |
| Day rollup | date (ISO) + UTC offset, requests, fgRequests, aiSeconds, per-model token classes (fresh in, cache write, cache read, out) and per-app breakdown, estimated-traffic bytes, privacy incident counts by category and tier, device-derived wh/waterMl/gco2/usd + factors version | one row per device per day; carries enough drivers to restate after events expire |
| Request event | ts (UTC), app, fg, ms, basis (measured/estimated), model + tier (measured), tokens {fresh in, cache write, cache read, out}, bytes {in, out} (estimated), device-derived wh, factors version | no URLs, no titles, no content |
| Privacy incident | ts, source (clipboard/composer), app surface, categories with tiers, top tier, resolution (cleared-by-button / acknowledged / auto-cleared / noted), ms-to-clear | the full anatomy of a near-miss; never the value that triggered it |
| Notice outcome | ts, notice id, family, shown/acted/dismissed | measures whether notices earn their keep |

Intraday shape (time-of-day, session lengths) is derived server-side
from event timestamps; nothing extra is collected for it.

Never stored, on device or off: message content, prompts, clipboard or
composer text, keystrokes, window titles, URLs, filenames, or the values
that triggered a privacy verdict.

## Tenancy and identity

One model serves both tiers: a **workspace** is either personal (consumer)
or organisational (commercial). Devices attach to a workspace; the ingest
path, schemas and ledger are identical.

- **Org workspace: org → teams → members → devices.** A member can have
  several devices; records carry a device id and roll up to the member.
  Devices enrol via MDM (the planned distribution channel) with a
  per-device key issued at enrolment. Uploads are authenticated per
  device; there are no shared credentials.
- **Personal workspace: one member, their devices.** Sync is opt-in from
  the welcome sheet, off by default; enrolment issues the same per-device
  key. The consumer sees only themselves, so the aggregation floor does
  not apply. Leaving sync on or off changes nothing about the pill.
- Member identity is pseudonymous in the events store (member uuid). The
  mapping to a directory identity (name, email) lives in a separate,
  smaller table that the aggregate query layer never joins against.

## Visibility model

| Viewer | Sees |
| --- | --- |
| The employee | everything about their own devices, at full resolution, including their upload ledger |
| Team/org dashboards | aggregates only: totals and distributions for energy, water, carbon, spend, request counts, and privacy events by category |
| Org admins | the same aggregates, plus enrolment/coverage status (which devices are reporting), never per-member usage |

Aggregation floor: a group figure is only shown when the group has at
least k members. k is org-configurable (default 5) so each organisation
can find its own use cases; a structural minimum of k = 3 remains,
because below that a "group" figure is really an individual, which
crosses the employee-first line. The floor is about identifiability,
never about hiding or judging usage levels. Below the floor, the figure
folds into the parent group.

**Privacy incidents: full clarity, no identity.** The org sees each
incident as it is: an API key reached the clipboard at 14:32 during a
Claude session, tier 1, cleared by the one-click remedy in 6 seconds.
That is what an organisation needs to understand what is happening and
train its people. What the incident record never carries at org level is
who: no member, device or team attribution, so a near-miss can never
become a mark against a person. The employee sees their own incidents in
full. Aggregate views add the training signal on top: categories by
tool, trend over time, share remedied and how fast.

**Third-party personal data is a first-class incident category.** A
patient's details, a class of children's grades, a colleague's
appraisal: identifiable personal data about people other than the user,
detected at the point of entry, before Send. Detection stays on-device
and rule-based (role words, record structure and identifiers must
co-occur; a capitalised name alone never fires; no AI, no content
stored), with categories such as third-party-health, childrens-data,
bulk-personal-records and hr-record. Coverage today is the **paste path
only**: the typed-entry guard, which read the Claude composer through the
macOS Accessibility API, was removed in 2.2.0 because it cost every user a
permission grant and put Drippy inside message text as it was written. The
L2 browser-extension and app adapters are the structural successors that
would restore entry-point coverage without that reach. Until one of them
ships, entry-point coverage is an open gap rather than a delivered
commercial requirement, and should be described that way to any buyer.

## The upload ledger (self-transparency)

A local, append-only ledger records every sync: timestamp, record counts
by type, byte size, destination, and the policy version in force. Shown
in-app (a "What has been shared" view reachable from What Drippy can
see). If Drippy ever cannot say what it sent, it must not send.

## Sync protocol

- Batch, not streaming: rollups and events are uploaded on day close and
  at most hourly for the current day, batched as JSONL, idempotent on
  (device id, record type, natural key) so retries are safe.
- The device buffers while offline and reconciles later; local files are
  never truncated by sync (retention below governs the cloud, the user
  governs their disk).
- Transport: TLS to a single ingest endpoint; payloads are the ledger
  entries' exact contents, so the ledger is provably complete.
- Every batch carries an envelope: device id, workspace id, sent-at,
  app version, OS + version, factors version, timezone offset and
  country (country-level only, for grid-intensity factors and
  data-quality cohorts; it adds nothing to identifiability).

## Retention

- Cloud request events: 90 days, then deleted (rollups carry the
  drivers, so nothing restatable is lost).
- Cloud privacy incidents: 12 months; they are rare, small, and the
  training-trend story needs more than a quarter.
- Cloud rollups: 24 months.
- Member leaves org: member uuid unlinked from directory identity
  immediately; remaining records count only towards historic aggregates.
- Org offboarding: full tenant export (JSONL, same shapes as upload),
  then deletion within 30 days.

## Compliance posture (UK company)

- UK GDPR / DPA 2018. TRNSPNC Ltd processes on behalf of the org
  (controller); a DPA and a DPIA template ship with the commercial tier.
  For personal workspaces TRNSPNC Ltd is the controller, and the privacy
  policy will say so in the same plain terms as PRIVACY.md.
- Data residency: UK/EU region only for the first release.
- Lawful basis is the org's to establish; Drippy's contribution is data
  minimisation by construction (verdicts, aggregates, k-floor) which
  makes the DPIA short.

## Backend

Neon managed Postgres, UK/EU region, behind a thin ingest service (one
endpoint, per-device keys, batch JSONL in, rows out). Nothing exotic
until scale demands it. Aggregates are materialised views over the
events/rollups tables; the k-floor and the identity separation live in
that view layer, so raw tables are never queryable by dashboards.

## Phasing

1. **Phase 1 (built 2026-07-21):** upload contract + ledger on device
   (sync.js: whitelisted shapes, hourly + day-close batches, cursor,
   intent-then-outcome ledger lines); ingest service (server/ingest.js
   with a memory store for development and store-pg.js + schema.sql for
   Neon); personal-workspace opt-in and the "What has been shared" view
   in the welcome sheet. Verified against real Neon (1,000 events, 9
   rollups, idempotent). Deployment is codified for Fly.io, London
   (server/Dockerfile, fly.toml, DEPLOY.md), so the ingest runs off-device
   and sync no longer depends on any one Mac being awake; the public
   endpoint is hardened with graceful shutdown and an optional
   ENROLL_TOKEN gate (device sends it via DRIPPY_ENROLL_TOKEN). Before
   paying customers: rotate the Neon credential, deploy behind Fly's TLS,
   replace the open enrolment stand-in with real auth, and turn on Neon
   PITR plus a log drain.
2. **Phase 2:** org dashboard MVP (aggregates, coverage, factors
   versioning, configurable k) and MDM enrolment flow.
3. **Phase 3:** reconcile with provider Admin/Usage APIs (fidelity L3) so
   org spend/energy figures graduate from estimated to measured, with
   provenance stated, as in the trends window.

## Decisions (Jack, 2026-07-21)

1. **Granularity:** rollups + coarse events.
2. **Consumer tier:** ships at launch, opt-in, same storage design
   (personal workspaces).
3. **Backend:** Neon managed Postgres, UK/EU.
4. **Aggregation floor:** org-configurable (default 5, structural
   minimum 3), paired with the neutrality principle: Drippy provides
   transparency, never a verdict on whether usage is high or low, good
   or bad; each organisation reads the numbers through its own values.
5. **Drivers, not derivatives** (second round, same day): records carry
   token classes, bytes, model and factor version; the cloud derives and
   restates figures. Request events gain the model dimension; privacy
   events become full incidents (tier, resolution, time-to-clear),
   org-visible in detail but identity-free; rollup dates are ISO with a
   UTC offset; batches carry the envelope above. The device starts
   capturing the richer shapes immediately, ahead of Phase 1, so history
   accrues at commercial grade from today.
6. **Third-party personal data breaches are in scope** (same day): a
   doctor typing patient information, a teacher pasting children's
   grades, a manager drafting appraisals from personal data. Caught at
   the point of entry, before Send; entry-point coverage (Accessibility,
   MDM-pre-approved for fleets, or an equivalent mechanism) is required,
   not optional. First rule-based detectors shipped the same day:
   third-party-health, childrens-data, bulk-personal-records at tier 1;
   hr-record at tier 2.

## Still open

- Consumer sign-in method (email magic link vs Sign in with Apple) and
  where the personal workspace is created.
- Pricing and packaging for both tiers.
- MDM vendor targets and enrolment payload details.
