# Server Coding Style & Convention Rules

This document defines the coding standards for the server directory. All collaborators **must** follow these rules to ensure consistency across the codebase.

---

## 1. Project Structure

```
server/
├── src/
│   ├── config/        # Configuration files (database, env, session, etc.)
│   ├── controllers/   # Request handlers (one file per resource)
│   ├── email/         # Email service & templates
│   ├── jobs/          # Cron/scheduled jobs
│   ├── lib/           # Shared utilities, helpers, validation schemas
│   ├── middlewares/    # Express middleware (auth, cache, rate-limit, error)
│   ├── models/         # Mongoose models (one file per model)
│   ├── routes/        # Express routers (one file per resource)
│   └── services/      # Business logic (complex/shared)
│   └── index.ts       # App entry point (Express setup & server start)
├── api/
│   └── index.ts       # Serverless entry point (re-exports app from src/index.ts)
├── dist/              # Compiled output
```

- Keep one file per logical unit (one model, one controller, one route file per resource).
- Place only the designated file types in each folder — no exceptions.

---

## 2. Model (`src/models/`)

### File naming

`{modelName}.ts` — all lowercase, singular (e.g., `user.ts`, `booking.ts`).

### Structure

```typescript
import mongoose, { Schema, Document } from "mongoose";

export interface I{ModelName} extends Document {
  _id: mongoose.Types.ObjectId;
  // fields...
}

const {ModelName}Schema = new Schema<I{ModelName}>(
  {
    // field definitions...
  },
  {
    timestamps: true,
  },
);

// Indexes go after schema definition
{ModelName}Schema.index({ fieldName: 1 });

// Export pattern — use existing model or create new one
const {ModelName} =
  mongoose.models.{ModelName} ||
  mongoose.model<I{ModelName}>("{ModelName}", {ModelName}Schema, "{collectionName}");

export default {ModelName};
```

### Rules

- **Export** an interface (`I{Name}`) extending `Document` and the model as **default export**.
- Use **camelCase** for field names.
- ObjectId references must use `Schema.Types.ObjectId` with `ref: "{ReferencedModel}"`.
- String enums should be defined as **inline union types** in both the interface and schema `enum`.
- Always include `timestamps: true`, `toJSON: { virtuals: true }`, `toObject: { virtuals: true }`.
- Index frequently-queried fields **after** the schema (not inside schema options).
- Always use `lean()` for read-only queries; omit when you need to `.save()` after mutations.

---

## 3. Controllers (`src/controllers/`)

### File naming

`{resource}.controller.ts` — singular, kebab-case (e.g., `auth.controller.ts`, `car.controller.ts`).

### Import pattern

```typescript
import { Request, Response, NextFunction } from 'express'
import { ModelName } from '../models/{modelName}.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import { sendTsRestError, sendTsRestSuccess } from '../lib/responseHandler.js'
```

### Export rules

- Each controller function must be a **named export** — never use `export default` for controller functions.
- Every controller function **must** be wrapped in `tryCatchWrapper()`.
- Use `.js` extension in all local import paths (ESM).

### Signature patterns

**Standard controller** (no `next` needed):

```typescript
export const doSomething = tryCatchWrapper(async (req: Request, res: Response) => {
  // logic...
  return sendTsRestSuccess(res, 200, {
    success: true,
    message: 'Success message',
    body: data,
  })
})
```

**Controller that uses `next`**:

```typescript
export const doSomething = tryCatchWrapper(async (req: Request, res: Response, _next: NextFunction) => {
  // use _next if you need to pass errors manually
})
```

### Response conventions

- **Success**: `sendTsRestSuccess(res, statusCode, { success: true, message: string, body?: any })`
- **Error**: `sendTsRestError(res, statusCode, "Error message")`
- **Paginated**: include `meta` object: `{ currentPage, limit, total, totalPages, hasMore }`
- Always return early on error: `return sendTsRestError(...)`
- Success responses MUST have `success: true` in the body (already done by `sendTsRestSuccess`).

### Controller logic rules

- Use `.lean()` for all read-only database queries.
- Use `req.session.userId` to get the current authenticated user's ID.
- Use `req.session.role` for role-checking in controllers.
- Extract pagination with: `const page = Number(req.query.page) || 1; const limit = Number(req.query.limit) || 10;`.
- Use `req.params` for route parameters, `req.query` for query strings, `req.body` for request body.
- Use `Promise.all()` for parallel independent database queries.
- Do NOT put business logic here that is shared across multiple controllers — move it to `src/services/`.

---

## 4. Routes (`src/routes/`)

### File naming

`{resource}.routes.ts` — singular, kebab-case (e.g., `auth.routes.ts`, `booking.routes.ts`).

### Structure

```typescript
import { Router } from 'express'
// imports...

const router = Router()

// Routes go here...

export default router
```

### Rules

- Export the router as **default export**.
- Use the middleware chain pattern: **rate limiter → auth guard → validation → cache clear → controller**.
- Route path segments should use **kebab-case** (e.g., `/my-bookings`, `/verify-email`).
- Attach route registration in `src/index.ts` using `app.use("/api/v1/{resource}", router)`.

### Middleware ordering (CRITICAL)

```typescript
router.post(
  '/register',
  customRateLimiter(5), // 1. Rate limit
  verifySession, // 2. Auth guard (if needed)
  validateFormData(schema), // 3. Input validation
  clearCache('pattern'), // 4. Cache invalidation (for mutations)
  controllerFunction // 5. Controller
)
```

### Available middleware

- **Rate limiting**: `strictLimiter` (sensitive routes), `customRateLimiter(n, windowMin)` (custom), `globalLimiter` (default).
- **Auth**: `verifySession` (logged-in users), `requireAdmin` (admin only), `requireRole(...)` (specific roles).
- **Validation**: `validateFormData(zodSchema)` — validates `req.body` against the schema.
- **Caching**: `cacheMiddleware("key")` (cache GET responses), `clearCache("pattern")` (clear after mutations).

---

## 5. Middleware (`src/middlewares/`)

### File naming

`{feature}.middleware.ts` — e.g., `auth.middleware.ts`, `error.middleware.ts`, `cache.middleware.ts`.

### Rules

- Extract reusable middleware logic into this directory.
- Auth middleware functions must use `sendTsRestError()` for unauthorized responses.
- The error middleware (`error.middleware.ts`) uses a custom `ErrorResponse` class with `statusCode`.
- The `formValidate.ts` middleware uses Zod schemas — if validation fails, return 400 with `{ success: false, message: "Validation failed", details: [...] }`.

---

## 6. Config (`src/config/`)

- One file per external dependency/config concern (e.g., `database.ts`, `session.ts`, `paystack.ts`, `email.ts`).
- `keys.ts` is the central env var manager with validation — all environment variables are read through `env` exported from here.
- Use lazy initialization for API clients (e.g., `getPaystack()` returns a singleton axios instance).

---

## 7. Lib (`src/lib/`)

- Contains shared utilities: `tryCatchWrapper.ts`, `responseHandler.ts`, `schemaValidation.ts`, `utils.ts`.
- Do NOT place files here that belong in `config/`, `services/`, or `middleware/`.

### tryCatchWrapper (`src/lib/tryCatchWrapper.ts`)

Already in use — all async controller functions must be wrapped with it. Do not modify this file.

### Response Handler (`src/lib/responseHandler.ts`)

- `sendTsRestSuccess(res, status, body)` — sends a success JSON response.
- `sendTsRestError(res, status, message, details?)` — sends an error JSON response with `{ success: false, message }`.
- Do NOT bypass these helpers; they ensure consistent response formatting.

### Schema Validation (`src/lib/schemaValidation.ts`)

- All Zod schemas defined here.
- Schema names should match the resource: `{resource}Schema` (e.g., `registerSchema`, `carSchema`, `bookingSchema`).

---

## 8. Services (`src/services/`)

- Complex business logic that spans multiple models or is reused across controllers.
- Use class-based structure exported as a singleton instance:

```typescript
export class {Name}Service {
  // methods...
}
export const {name}Service = new {Name}Service();
```

- Services should NOT import from `express` or handle `req`/`res` directly — leave that to controllers.

---

## 9. Email (`src/email/`)

- Email service functions in `send-email.ts` — all email sending logic.
- HTML templates in `templates.ts`.
- Email functions should return `{ success: boolean, queued: boolean }`.
- Failed emails should be queued in the `FailedEmail` model for retry via cron job.

---

## 10. Jobs (`src/jobs/`)

- Each job file exports `start{JobName}()` and optionally `stop{JobName}()` functions.
- Jobs are started in `src/index.ts` inside `startServer()`.

---

## 11. Index / Entry Point (`src/index.ts`)

### Structure

- Augment Express types globally at the top.
- Middleware ordering (CRITICAL): CORS → Rate limiter → Session → Body parsers → Request time → Routes → 404 → Error handler.
- API routes registered under `/api/v1/{resource}`.
- Separate function for server startup (`startServer()`).
- Conditional startup for serverless (VERCEL env check).

### Import style

- Local imports must include `.js` extension (ESM requirement).
- Named exports preferred for all modules except routers (default export).

---

## 12. General Coding Conventions

### TypeScript

- Use **strict mode** (`"strict": true` in tsconfig).
- Target: `ES2022`, Module: `NodeNext`, ModuleResolution: `NodeNext`.
- Use explicit types for all function parameters and return types.
- Use `interface` over `type` for object shapes, especially `extends Document`.

### Imports

- Always use `.js` extension for local imports (e.g., `../model/user.js`).
- Prefer named imports over default imports for non-Router modules.
- Group imports: 3rd party → local.

### Error handling

- All errors from async controllers are caught by `tryCatchWrapper` and forwarded to the global error handler.
- The global error handler (`appErrorHandler`) handles Mongoose `CastError`, duplicate key (code 11000), and `ValidationError`.
- Use `throw` for errors you want the global handler to process (when not using `sendTsRestError`).

### Global type augmentations

Define augmented types in the file where they're primarily used:

- `Express.Request` extensions — in `src/index.ts` and `src/middleware/auth.middleware.ts`.
- `express-session.SessionData` — in `src/index.ts`.

### File convention summary

| Directory    | File Pattern               | Export Style                             |
| ------------ | -------------------------- | ---------------------------------------- |
| models/       | `{model}.ts`               | `export default Model`                   |
| controllers/ | `{resource}.controller.ts` | Named exports only                       |
| routes/      | `{resource}.routes.ts`     | `export default router`                  |
| middlewares/  | `{feature}.middleware.ts`  | Named exports                            |
| config/      | `{feature}.ts`             | Named exports (and default if singleton) |
| lib/         | `{feature}.ts`             | Named exports or default                 |
| services/    | `{resource}.service.ts`    | Class + singleton instance               |
| email/       | `{feature}.ts`             | Named + default (service object)         |
| jobs/        | `{jobName}.ts`             | Named exports                            |

---

_This file must be kept in sync with the actual codebase. If you discover new patterns or need to update rules, do so after team discussion._