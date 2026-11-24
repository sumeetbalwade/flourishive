# Flourishive integrator guide

Connect another system (an ERP, a payroll tool, a data warehouse) to Flourishive. This covers signing in with an API client, the endpoints, limits, idempotency and webhooks.

Base address: `https://api.<your domain>` (shown on **Company → API access**). Every path below starts with `/v1`.

## 1. Create an API client

A company admin opens **API access** and adds a client:

- **Name**, for your own reference.
- **What it may do** (scopes): `employees:read`, `letters:read`, `letters:create`.
- **Which companies** (legal entities) it may touch. Leave all unticked for every company in your tenant.
- **Requests per minute**.

Flourishive shows the **client ID** and **client secret** once. Store the secret like a password. You can rotate it or pause the client at any time; a paused or deleted client stops working immediately.

A client acts as the admin who created it. It can never do more than that person is allowed to do, so a letter created through the API is created by that person.

## 2. Get a token

OAuth 2.0 client credentials. Tokens last one hour.

```bash
curl -X POST https://api.example.com/v1/oauth/token \
  -H 'Content-Type: application/json' \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "fhc_…",
    "client_secret": "fhs_…",
    "scope": "employees:read letters:create"
  }'
```

`scope` is optional (default: everything the client may do) and may only narrow it. Response:

```json
{ "access_token": "eyJ…", "token_type": "Bearer", "expires_in": 3600, "scope": "employees:read letters:create" }
```

Send it on every call: `Authorization: Bearer <access_token>`. Request a new token shortly before it expires.

## 3. Endpoints

| Method | Path | Scope | What it does |
| --- | --- | --- | --- |
| GET | `/v1/api/employees` | `employees:read` | List employees and interns |
| GET | `/v1/api/employees/{id}` | `employees:read` | One person (the id is the engagement id) |
| POST | `/v1/api/letters` | `letters:create` | Create a letter from a template |
| GET | `/v1/api/letters/{id}` | `letters:read` | Letter status |

### List employees

Query: `page` (default 1), `pageSize` (1–100, default 50), `updatedSince` (ISO 8601, only records changed since), `entityId` (one company).

```json
{
  "data": [{
    "id": "…", "personId": "…", "employeeCode": "FS-0042", "type": "EMPLOYEE", "status": "ACTIVE",
    "companyId": "…", "firstName": "Asha", "lastName": "Rao", "workEmail": "asha@acme.com",
    "phone": null, "department": "Finance", "designation": "Analyst", "location": "Pune",
    "startDate": "2026-01-05", "endDate": null, "updatedAt": "2026-11-24T05:10:00.000Z"
  }],
  "page": 1, "pageSize": 50, "total": 1
}
```

To sync, call with `updatedSince` set to the time of your last successful sync.

### Create a letter

```bash
curl -X POST https://api.example.com/v1/api/letters \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Idempotency-Key: 2f1c6a9e-offer-asha-2026-11' \
  -H 'Content-Type: application/json' \
  -d '{
    "templateId": "…", "entityId": "…", "engagementId": "…",
    "fields": { "salary": "1200000", "joiningDate": "2026-12-01" }
  }'
```

Returns `201` with `{ id, reference, status, companyId, createdAt }`.

## 4. Idempotency

Send an `Idempotency-Key` header (up to 120 characters, one per intended action) on create calls. If your request times out, repeat it with the same key:

- same key, same body → the original answer again (`200`, header `Idempotent-Replayed: true`); no second letter;
- same key, different body → `422 IDEMPOTENCY_KEY_REUSED`;
- first request still running → `409 IDEMPOTENCY_IN_PROGRESS`.

Keys are remembered for 24 hours. A request that failed can be retried with the same key.

## 5. Rate limits

Each client has a per-minute limit. Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix time). Over the limit you get `429` with `Retry-After` in seconds. Back off and retry.

## 6. Errors

JSON body with `message` and, where useful, `code`.

| Status | Meaning |
| --- | --- |
| 400 | The request is invalid |
| 401 | Missing, expired or bad token, or a paused client |
| 402 | `PLAN_LIMIT` or `READ_ONLY`: the company's plan or a late payment blocks the change |
| 403 | `INSUFFICIENT_SCOPE`, or a company the client is not allowed to use |
| 404 | Not found (also used for records outside the client's companies) |
| 422 | Idempotency key reused with a different body |
| 429 | Rate limited |

## 7. Webhooks

Instead of polling, add an endpoint under **Company → Webhooks**. Choose the events:

| Event | When |
| --- | --- |
| `employee.created` | A person is added |
| `employee.updated` | A person's details change |
| `letter.created` | A letter is created (in the app or through the API) |

Each delivery is a `POST` with a JSON body:

```json
{ "id": "event uuid", "type": "employee.created", "createdAt": "2026-11-24T05:10:00.000Z", "data": { "id": "…", "employeeCode": "FS-0042" } }
```

Headers: `X-Flourishive-Event`, `X-Flourishive-Delivery` (unique per delivery), `X-Flourishive-Signature`.

### Verify the signature

The header is `t=<unix time>,v1=<hex>`. `v1` is HMAC-SHA256, keyed with your endpoint's signing secret, over `<t>.<raw request body>`. Always compute it over the raw bytes, and reject deliveries whose `t` is more than five minutes old.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret) {
  const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return v1.length === expected.length && timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

### Delivery and retries

Answer with any `2xx` within 10 seconds. Anything else (or no answer) is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours; after the sixth try the delivery is marked failed. The same event can arrive more than once, so de-duplicate on `id`. The **Delivery log** shows every attempt and lets you send a delivery again; **Send a test** sends a signed `ping`.

Endpoints must be `https` and reachable from the public internet. Private and internal addresses are refused, and redirects are not followed.
