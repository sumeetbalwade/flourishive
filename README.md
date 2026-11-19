# Flourishive

Multi-tenant HR management platform. Flourisense is tenant #1.

Start with [docs/00-master-plan.md](docs/00-master-plan.md): every approved decision, the architecture, folder structure and phases.

## Apps

| Folder             | What                                                         | Deploys to                                |
| ------------------ | ------------------------------------------------------------ | ----------------------------------------- |
| `backend/`         | NestJS REST API (`/v1`), the only place business logic lives | `api.flourishive.in` (cPanel Node.js App) |
| `frontend/web/`    | Customer workspace SPA                                       | `app.flourishive.in`                      |
| `frontend/admin/`  | Super admin console SPA                                      | `admin.flourishive.in`                    |
| `frontend/verify/` | Public document verification                                 | `verify.flourishive.in`                   |
| `desktop/`         | Flourishive Desktop (Python): DSC signing, DOCX → PDF        | Windows + macOS installers                |
| `packages/`        | Shared tokens, UI, API client, schemas, config               | not deployed on its own                   |

## Local development

Requires Node 24, pnpm, Python 3.12 and uv; MySQL, Redis, Mailpit and SoftHSM via Homebrew.

```bash
pnpm install
pnpm build                                   # build every app
pnpm --filter @flourishive/backend test      # API unit tests
pnpm --filter @flourishive/backend test:e2e  # API e2e tests
pnpm --filter @flourishive/web dev           # http://localhost:5173 (admin 5174, verify 5175)
cd desktop && ./spikes/softhsm-selftest.sh   # signing self-test with a test token
```
