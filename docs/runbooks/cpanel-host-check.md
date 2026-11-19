# Runbook: check the existing cPanel hosting

Fill in the **What you see** column and send it back. Each row maps to the hosting checklist in plan §3.2. Ask the host's support team for anything you can't find on screen.

| # | Where in cPanel | What to check | Needed | What you see |
|---|---|---|---|---|
| 1 | Software → **Setup Node.js App** | Page exists; which Node versions are in the dropdown | Node 22 or 24 | |
| 2 | Software → **Setup Python App** | Page exists (not used on the server now, just record it) | – | |
| 3 | Wherever your host shows **Redis** (often Software, or ask support) | Version; connection (host/port or socket); password protected? | Password or private socket | |
| 4 | Same, or ask support | Redis **memory limit**, and does it **save data to disk** (persistence)? | Note values | |
| 5 | Advanced → **Cron Jobs** | "Common Settings" dropdown includes **Once Per Minute (\* \* \* \* \*)** | 1-minute cron | |
| 6 | Security → **SSH Access**, and Advanced → **Terminal** | Both pages exist | SSH for deploys (D-22) | |
| 7 | Databases → **phpMyAdmin** (home page, "Database server" box) | Server type and version | MySQL 8.0+ or MariaDB 10.6+ | |
| 8 | Right sidebar → **Statistics** | Disk limit, Physical Memory limit, Entry Processes, Number of Processes, Inodes | ≥ 2 GB memory, ≥ 50 GB disk | |
| 9 | Domains → **Domains** | Can you add another domain (`flourishive.in`) and subdomains? | Yes | |
| 10 | Security → **SSL/TLS Status** | AutoSSL is available | Yes | |
| 11 | Email → **Email Deliverability** | Page exists (we set SPF/DKIM there later) | – | |
| 12 | Host's billing area or support | Server location (city/country) | India preferred | |

Also note: the hosting company's name and plan name.
