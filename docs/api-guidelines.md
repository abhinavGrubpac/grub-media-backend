# API Guidelines

## Versioning & prefix
All routes under `/api/v1` (global prefix `api` + URI versioning, default `1`). Health is version-neutral (`/api/health` + `/api/v1/health`). New breaking versions add `/api/v2` controllers without touching v1.

## REST conventions
Plural nouns; the HTTP method expresses the action.
```
GET    /api/v1/users
GET    /api/v1/users/:id
POST   /api/v1/users
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id   # soft delete
```
No verbs in paths (`POST /users`, not `POST /users/create`).

## Response envelopes
Success (via global ResponseInterceptor):
```json
{ "success": true, "message": "Users fetched successfully", "data": [], "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 } }
```
`message` comes from `@ResponseMessage('...')`; `meta` is present only for paginated lists. Routes with their own contract (health) use `@SkipResponseWrap`.

Error (via global AllExceptionsFilter):
```json
{ "success": false, "statusCode": 400, "message": "Validation failed", "errorCode": "VALIDATION_ERROR", "timestamp": "2026-10-08T10:00:00.000Z", "path": "/api/v1/users", "requestId": "..." }
```
`errorCode` is the stable, machine-readable key (branch on it, not on `message`): `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BAD_REQUEST`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`.

## DTOs
Per resource: `Create*`, `Update*` (PartialType), `*Query` (extends `PaginationQueryDto`), `*Response` (`@Expose` allowlist). Controllers never return Prisma models. Global `ValidationPipe` uses `whitelist`+`forbidNonWhitelisted`+`transform`, so unknown fields are rejected 400.

## Pagination
Query: `page` (≥1, default 1), `limit` (1–100, default 20), `sortBy`, `sortOrder` (`asc`|`desc`). `sortBy` is allowlisted server-side per resource (no arbitrary column reaches the DB). Cursor pagination can be added later for high-volume resources.

## Correlation id
Send `X-Request-ID` (UUID or `[A-Za-z0-9_-]{8,64}`) to correlate; otherwise one is generated. It is echoed in the response and in every log line.

## Swagger
`/api/docs`. Decorate controllers/DTOs with `@ApiTags`, `@ApiOperation`, `@ApiBearerAuth`, `@ApiProperty(Optional)`. Treat Swagger as part of the API contract.
