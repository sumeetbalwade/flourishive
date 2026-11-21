# Runbook: scheduled jobs (cPanel cron)

Set up at launch (cPanel → Advanced → Cron Jobs). Run both from the API's folder with the same
environment as the API; `<node>` is the Node binary the Node.js App uses.

| When | Command | What it does |
|---|---|---|
| Every minute | `<node> dist/cli.js worker --max-seconds=55` | Runs queued jobs (emails, later letters and signing); re-queues stale jobs |
| Nightly, for example 02:30 | `<node> dist/cli.js verify-audit` | Re-computes every company's audit hash chain, plus the platform's own |

## Nightly audit check
- Prints one line, for example `Checked 1842 audit rows across 3 companies: all chains intact`.
- Writes `platform.audit_chain_verified` (or `platform.audit_chain_broken`) to the platform audit log.
- If any chain is broken (a row edited, removed or cut off) it **emails every active platform admin**, names the
  company and the first broken row, and exits with code 2 so cron's own mail also reports it.
- A broken chain is a security incident: do not repair the database; keep it as it is and find out who had access.
- You can run it by hand at any time: `<node> dist/cli.js verify-audit`.
