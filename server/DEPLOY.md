# Deploying the Drippy ingest to Fly.io

The ingest is a small persistent Node service: it receives usage batches
from Drippy devices and writes them to Neon (UK/EU). Hosting it on Fly
means sync works whether or not any one device (your Mac) is awake.

The `Dockerfile` and `fly.toml` in this folder **are** the deployment.
A teammate can redeploy from git alone; nothing is clicked into place.

Region is London (`lhr`) and the machine is always-on, both deliberate:
London keeps the UK/EU data-residency story clean, and always-on leaves
room for the scheduled work on the roadmap (retention sweeps, aggregation)
to run in this same service later.

Steps marked **(you)** need your credentials, so they are yours to run.
Steps marked **(me)** I can do from here once you hit that point.

---

## 0. Install flyctl and sign in  (you, once)

```sh
brew install flyctl          # or: curl -L https://fly.io/install.sh | sh
fly auth signup              # or `fly auth login` if you already have an account
```

## 1. Rotate the Neon credential  (you, ~2 min)

The current `DATABASE_URL` has lived on your Mac's disk and been used from
it, so treat it as burned. In the Neon console → your project → **Roles**,
reset the role password (or create a fresh role), and copy the new
**pooled** connection string. Prefer `sslmode=verify-full` in it (stronger
than `require`; it also silences the pg driver warning).

Keep the new string handy for the next two steps. Do not commit it
anywhere — `.env.local` and Fly secrets are the only places it belongs.

## 2. Create the app  (you, from this folder)

```sh
cd ~/Documents/Work/Drippy/server
fly launch --no-deploy --copy-config --name drippy-ingest --region lhr
```

`--copy-config` uses the `fly.toml` here; `--no-deploy` holds off until the
secrets are set. If `drippy-ingest` is taken, pick another name — the URL
becomes `https://<name>.fly.dev`, and tell me the name for step 6.

## 3. Set the secrets  (you)

```sh
# The rotated Neon string:
fly secrets set DATABASE_URL="postgresql://…verify-full"

# Gate enrolment so the now-public endpoint can't be spammed. Generate one,
# set it, and keep the value — you only need it to enrol NEW devices:
fly secrets set ENROLL_TOKEN="$(openssl rand -hex 24)"
```

The schema is already applied to your Neon database from earlier, and
rotating the password does not change it — so there is nothing to migrate
unless you moved to a brand-new database. (If you did:
`DATABASE_URL="<new string>" npm run migrate`.)

## 4. Deploy  (you)

```sh
fly deploy
```

Then confirm it is up and talking to Postgres:

```sh
curl https://drippy-ingest.fly.dev/v1/health
# → {"ok":true,"db":"postgres"}
```

## 5. Point your device at the hosted ingest  (me)

Your device is already enrolled in Neon, and the hosted ingest reads the
same database, so **no re-enrolment** — only the endpoint changes. Give me
the `https://<name>.fly.dev` URL and I will:

- set `endpoint` in `~/Library/Application Support/Drippy/sync.json` to it,
- restart Drippy,
- watch the ledger's next batch land `ok` against the new host,
- and confirm the row counts in Neon are unchanged (idempotent, so nothing
  double-counts).

## 6. Verify it survives a restart  (you + me)

Quit Drippy, stop the old local ingest if it is still running, and reopen
Drippy. The next sync should still succeed — because the ingest no longer
lives on your Mac. Right-click the pill → What Drippy can see shows the
ledger; a fresh `ok` line against the Fly URL is the proof.

---

## Cost

One always-on `shared-cpu-1x` / 512 MB machine in London is roughly
£2–3 / month. Scaling later is horizontal (more machines, or a bigger
size) with no code change.

## Not done yet (tracked in DATA-STORAGE.md)

- **Enrolment is still a stand-in.** `ENROLL_TOKEN` stops random abuse, but
  real org onboarding (MDM) and consumer sign-in replace it before paying
  customers. The device sends the token via `DRIPPY_ENROLL_TOKEN` if it
  ever needs to enrol against a gated ingest.
- **Observability and backups.** Turn on Neon point-in-time recovery, and
  add a Fly log drain / alert, before real tenants.
