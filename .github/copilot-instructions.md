# Copilot Instructions

## Iterative Development — The Prime Directive

**Never declare a task complete until you have proven end-to-end it works.**

After every change:
1. Run the affected service(s) and exercise the changed behaviour
2. Check backend logs for errors and warnings
3. Verify the UI reflects the expected outcome in a real browser or via curl
4. Fix any failures before stopping — do not report "done" and leave broken behaviour behind

If you cannot exercise something end-to-end, say so explicitly and explain what is blocking the verification.

---

## Security

- Never commit secrets, keys, or credentials. Use environment variables or a secret manager.
- Use cryptographically secure random functions (`secrets` module, `os.urandom`) everywhere randomness is needed for security purposes. Never use `random` for tokens, passwords, or IDs.
- Validate and sanitise all user-supplied input at the boundary. Reject rather than silently truncate.
- Prefer `HttpOnly` cookies over `localStorage` for auth tokens.
- Fetch third-party resources with pinned versions and Subresource Integrity (SRI) hashes.
- Avoid exposing internal error detail or stack traces in API responses.
- Follow the principle of least privilege: containers should run as non-root, DB users should have minimal grants, tokens should be scoped to the minimum required claim set.
- Guard any file-system path derived from user input against directory traversal.

---

## Data Integrity

- Enforce referential integrity at the database level (foreign keys with explicit cascade rules), not only in application code.
- All schema changes must go through a migration tool. Never use destructive `drop_all / create_all` patterns outside of a clearly isolated local seed script.
- Wrap multi-step mutations in a transaction. If any step fails, roll back completely.
- Production initialisation scripts must be idempotent — safe to run against a live database without data loss.

---

## Code Quality

- Keep modules focused on a single responsibility. Split large modules before they become hard to reason about.
- Do not duplicate business logic between frontend and backend. Own the authoritative calculation in one place, expose it via the API.
- Remove debug logging (`console.log`, temporary `print`) before considering any task complete.
- Pin dependencies precisely and maintain a lockfile. Contradictory or under-specified version ranges are bugs.
- Write tests for every new behaviour. When fixing a bug, write a test that would have caught it first.

---

## API Design

- Keep HTTP method semantics correct: GET reads, POST creates, PUT/PATCH updates, DELETE removes.
- Version APIs or agree on a compatibility contract before breaking changes.
- Return consistent, structured error responses. Include a machine-readable error code alongside a human-readable message.
- Avoid leaking sensitive values (tokens, internal IDs, emails) in URLs or query parameters — they appear in server logs.

---

## Testing and Verification

- After any backend change: re-run affected tests, then manually exercise the route (curl or Swagger UI), check logs.
- After any frontend change, or any backend change that might impact user experience: use the **Chrome DevTools Agent Plugin** (via the `chrome-devtools` skill) as the preferred method for interactive end-to-end verification — navigate to the affected page, interact with it, and inspect the console and network requests for errors. Fall back to manual browser testing only if the plugin is unavailable.
- After any infrastructure/config change: redeploy to a non-production environment first, verify health checks pass, then promote.
- Treat a broken integration (e.g., mismatched HTTP method between client and server) with the same urgency as a crash.
- When using Chrome DevTools for e2e verification: take a screenshot to confirm visual state, check `list_network_requests` for unexpected 4xx/5xx responses, and check `list_console_messages` for JS errors — all before declaring a task complete.
- Run the Playwright e2e test suite (`npm test`) after any change and confirm all tests pass before declaring the task complete. If a test fails, fix the issue — do not skip or disable the test.

---

## General Practices

- Prefer small, reviewable, atomic commits over large sweeping changes.
- When modifying auth flows, test both the happy path and denial cases (wrong credentials, expired token, insufficient role).
- When in doubt about an approach, surface the trade-offs and make a concrete recommendation rather than asking an open-ended question.
