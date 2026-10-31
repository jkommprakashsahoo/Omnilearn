# Authentication and Security

> **Scope:** This document records the production security target for OmniLearn. The requested `PRD.md`, `ARCHITECTURE.md`, `DATABASE.md`, and `API.md` were not present in the workspace; this guide is based on the available README and source code. Recommendations below are not claims that the controls have already been implemented.
>
> **Current-state warning:** Before launch, remove the demo/guest authentication fallback, replace the hard-coded JWT secret fallback, verify Firebase identity tokens server-side, and replace the six-character password minimum and long-lived localStorage JWT. The current backend has email/password registration and login, a Firebase sync endpoint, bcrypt hashing, and Zod validation; it does not implement refresh tokens, password reset, or magic links.

## Authentication methods and account flows

| Method or flow | Production behavior | Choice and reason |
|---|---|---|
| Email and password signup | Validate and normalize the email, enforce the password policy below, create the account with an Argon2id password hash, send a single-use email-verification link, and issue a session only after verification (or apply a documented restricted-unverified state). Return a generic response where account existence could be disclosed. | Email verification helps prevent account takeover through mistyped or claimed addresses. |
| Email and password login | Accept credentials over HTTPS, apply IP and account-based throttles, verify the password hash, and return the same generic failure for unknown email and wrong password. On success, create a session and issue a short-lived access token. | Generic failures and throttling reduce account enumeration and credential-stuffing risk. |
| OAuth (Google) | Use Firebase Authentication’s Google provider with authorization-code/popup handling in the client; send the Firebase ID token to the backend and verify its signature, issuer, audience, expiry, and subject using the Firebase Admin SDK before mapping the verified `uid` to an account. Do not trust a client-supplied `uid`, email, or profile as proof of identity. | A verified provider assertion avoids collecting a Google password and prevents forged identity sync requests. |
| Magic-link login | Generate a cryptographically random, single-use token; store only its hash, bind it to the account and purpose, expire it after 15 minutes, and email a link to a same-origin confirmation page. Consume it atomically, then issue a session; do not put credentials or access tokens in the URL after redemption. | A short-lived, single-use link supports passwordless login while limiting replay if the link is exposed. |
| Logout | Revoke the current refresh-token session server-side, clear the refresh cookie with the same attributes used to set it, and discard the in-memory access token; offer “log out all devices” by revoking every session for that user. | Server-side revocation makes logout meaningful even before a token naturally expires. |
| Password reset request | Always return the same success-shaped response whether or not the email exists; rate-limit requests, create a random one-time token, store only its hash, expire it after 15 minutes, and send it only to the verified account email. | Uniform responses prevent account discovery and hashed tokens limit damage from a database leak. |
| Password reset completion | Validate the token and new password, atomically consume the token, store the new Argon2id hash, revoke all refresh sessions, and notify the account email; require a fresh login rather than automatically signing the user in. | Revoking existing sessions limits the impact of a compromised password and reset link. |
| Email change | Require a recent authenticated session and re-authentication, verify the new address, notify the old address, and revoke other sessions after the change. | Re-authentication and notifications make silent account takeover harder. |

### Browser and API session flow

1. The browser sends credentials or a verified provider assertion to the HTTPS API; credentials and provider tokens are never written to browser storage or logs.
2. The API validates the request, authenticates the user, and creates a server-side refresh session with a random opaque refresh token.
3. The API returns a short-lived signed access token in the response body and sets the refresh token in a `Secure`, `HttpOnly`, `SameSite=Lax` cookie scoped to the refresh endpoint.
4. The client keeps the access token in memory and sends it as `Authorization: Bearer <token>` for protected API requests.
5. Before access-token expiry, the client calls the refresh endpoint with the cookie and CSRF protection; the server rotates the refresh token and returns a new access token.
6. On logout, refresh-token reuse detection, password reset, or account-security event, revoke the affected session or token family and clear the cookie.

## JWT and session design

| Choice | Rule | Reason |
|---|---|---|
| Access-token lifetime | Sign access JWTs with a 10-minute expiry and a fixed allowed algorithm; include `iss`, `aud`, `sub`, `iat`, `exp`, `jti`, and a token-use claim. | A short expiry limits the usable window if an access token is stolen. |
| Access-token contents | Include only a stable user ID and minimal authorization claims; never include passwords, secrets, sensitive profile data, or data that can change without re-issuance. | JWT payloads are readable by their holders and are not encrypted by signing. |
| Refresh-token lifetime | Use a cryptographically random opaque token with a 30-day absolute expiry and a 7-day inactivity expiry; store only its hash, session metadata, and revocation state server-side. | Opaque server-tracked tokens support reliable revocation and reduce exposure of signing keys. |
| Refresh rotation | Issue a new refresh token on every successful refresh, invalidate the previous token atomically, and revoke the entire token family if an invalidated token is presented again. | Rotation detects replay and limits refresh-token theft. |
| Signing keys | Use a dedicated, high-entropy secret or asymmetric key pair from a managed secret store; support key IDs and planned key rotation, and never fall back to a source-code default. | Dedicated managed keys reduce accidental disclosure and allow safe rotation. |
| Browser storage | Keep access tokens in memory only; store refresh tokens only in `Secure`, `HttpOnly` cookies, never in `localStorage`, `sessionStorage`, URLs, or browser-readable cookies. | HttpOnly cookies reduce direct token theft by injected JavaScript, while memory avoids persistence across browser restarts. |
| API verification | Validate signature, algorithm, issuer, audience, expiry, token-use claim, and required subject; reject missing, malformed, expired, or revoked credentials with `401`. | Explicit claim validation prevents token confusion and forged or stale sessions. |
| Logout and revocation | Require server-side refresh-session revocation; keep access-token expiry short and check revocation where immediate revocation is required. | Stateless JWTs cannot otherwise be invalidated before expiry. |

## Roles and permissions

Authorization is enforced by the API on every request, not by hiding client-side controls. Resource queries must always be scoped to the authenticated owner; clients must not set or override ownership fields.

| Capability | Anonymous | Student (default) | Admin |
|---|---:|---:|---:|
| View public landing and health status | Yes | Yes | Yes |
| Register, authenticate, request password reset | Yes | Yes | Yes |
| View or edit own profile and sessions | No | Own account only | Own account only |
| Create, view, update, delete own workspaces and files | No | Own resources only | Only when explicitly needed for support and audited |
| Use chat, study-guide, science, and video APIs | No | Own authorized workspace; apply service quotas | Only for authorized operational purposes |
| Read another user’s private profile, workspace, files, or messages | No | No | No by default; exceptional access must be approved and audited |
| Assign roles, manage users, change security settings | No | No | Yes, with MFA and audit logging |

| Role rule | Choice and reason |
|---|---|
| Default role | Assign `student` server-side at account creation; never accept a role from a public request. | A safe default prevents privilege escalation through crafted signup data. |
| Admin role | Grant only through a controlled administrative process, require MFA, and record role changes in an immutable audit log. | Stronger controls protect high-impact administrative actions. |
| Authorization checks | Deny by default and verify both capability and resource ownership in the API and database query. | Defense in depth prevents insecure direct-object-reference access. |

## Password storage and account protection

| Control | Rule | Reason |
|---|---|---|
| Password hashing | Use Argon2id with parameters calibrated to the production service and reviewed at deployment; use a unique salt per password via the password-hashing library. | Argon2id is memory-hard and slows offline password guessing. |
| Legacy hashes | If bcrypt hashes exist, verify them during login and rehash with Argon2id after successful authentication; never convert or persist plaintext. | Opportunistic rehashing upgrades accounts without a forced reset. |
| Password length | Require at least 15 characters when password-only authentication is available; accept passphrases and at least 64 characters, with a documented upper bound that avoids denial-of-service input. Do not impose arbitrary character-class rules. | Length and blocklists provide better resistance and usability than composition rules. |
| Password screening | Reject common, breached, or context-specific passwords; do not silently trim or alter passwords. | Blocking known weak choices reduces guessing risk without changing user input. |
| Password handling | Use HTTPS, redact credentials from logs and telemetry, and never store, email, or return plaintext passwords. | Passwords should exist only transiently for verification or hashing. |

## Rate limiting and abuse controls

| Endpoint/action | Initial limit (tune with measured traffic) | Reason |
|---|---|---|
| Login | 5 failed attempts per account per 15 minutes and 20 per IP per 15 minutes, with progressive delay rather than permanent lockout. | Layered limits slow credential stuffing without allowing easy account-lockout denial of service. |
| Signup | 5 attempts per IP per hour, plus email verification and abuse monitoring. | Signup limits reduce automated account creation. |
| Password-reset and magic-link requests | 3 requests per account per hour and 10 per IP per hour; keep response timing and body independent of account existence. | Limits constrain email abuse while avoiding account enumeration. |
| Token refresh | 30 requests per session per hour; reject reuse of rotated tokens and revoke the token family. | Refresh limits reduce automated replay and detect anomalous session behavior. |
| Expensive authenticated APIs | Per-user quotas and per-IP ceilings for uploads, AI generation, and search; return `429` with `Retry-After`. | Cost-aware limits prevent resource exhaustion and unexpected provider charges. |
| Rate-limit storage | Use a shared, atomic store in production and account for trusted proxy configuration; do not rely on per-process memory across multiple instances. | Distributed deployments need consistent enforcement across all application instances. |

## CORS, CSRF, and browser protections

| Control | Rule | Reason |
|---|---|---|
| CORS | Prefer same-origin deployment; otherwise allow only the explicit production frontend origins, required methods, and required headers. Never combine credentialed requests with wildcard origins. | An allowlist prevents untrusted sites from reading credentialed API responses. |
| CSRF | For cookie-authenticated refresh or other state-changing endpoints, require a synchronizer token or correctly implemented double-submit token and validate `Origin`/`Referer`; retain `SameSite=Lax` as defense in depth. | Browsers attach cookies automatically, so state-changing cookie requests need CSRF defenses. |
| Bearer API requests | Require a valid bearer access token for protected routes; missing credentials must never create a demo or guest identity. | Explicit authentication prevents unintended access under a fabricated identity. |
| Security headers | Apply Helmet or equivalent headers, including a restrictive Content Security Policy, `frame-ancestors`, `X-Content-Type-Options`, and `Referrer-Policy`; enable HSTS only when HTTPS is fully deployed. | Browser security headers reduce clickjacking, content sniffing, and script-injection impact. |
| TLS | Require HTTPS in production, redirect HTTP to HTTPS at the trusted edge, and use secure cookies only over HTTPS. | Transport encryption protects credentials and session tokens in transit. |

## XSS and output handling

| Control | Rule | Reason |
|---|---|---|
| React rendering | Render user content as text by default; avoid `dangerouslySetInnerHTML` and never treat model output, filenames, profile values, or chat messages as trusted HTML. | Contextual text rendering prevents untrusted content from becoming executable markup. |
| Rich text | If rich HTML is a product requirement, sanitize with a maintained allowlist sanitizer immediately before rendering and restrict allowed tags, attributes, and URL schemes. | Sanitization limits active markup while preserving explicitly supported formatting. |
| Content Security Policy | Use a restrictive nonce-based CSP without `unsafe-eval`; allow only the required script, style, image, and connection sources. | CSP provides a second barrier against injected scripts. |
| Data handling | Escape values for their output context and use parameterized database operations; do not rely on input sanitization as a substitute for safe rendering. | Contextual output encoding and parameterization address different injection paths. |

## Input validation and sanitization

| Input | Rule | Reason |
|---|---|---|
| Request shape | Validate every route with Zod or an equivalent schema; reject unknown fields where practical and validate route parameters, query strings, and multipart metadata as well as JSON bodies. | Explicit schemas prevent malformed and mass-assigned data from reaching business logic. |
| Email | Trim surrounding whitespace, normalize to lowercase for lookup and uniqueness, validate format and maximum length, and verify ownership before enabling account recovery. | Canonicalization prevents duplicate identity records and untrusted recovery addresses. |
| Names and text | Enforce field-specific length limits, reject unexpected control characters, and store plain text; preserve legitimate Unicode rather than attempting to strip all markup. | Field bounds limit resource abuse while context-specific output encoding handles HTML safety. |
| Passwords and tokens | Enforce length and type limits, but never trim, normalize, log, or sanitize credentials or cryptographic tokens. | Altering credentials changes their meaning and can create authentication bypasses. |
| IDs and ownership | Validate identifier syntax and load resources using both the ID and authenticated owner ID; ignore client-supplied owner or role fields. | Owner-scoped lookups prevent cross-account access and mass assignment. |
| File uploads | Enforce allowed extensions and verified content types, maximum size/count, generated storage names, malware/content scanning as appropriate, and private storage with authorization on download. Never trust the supplied filename or MIME type alone. | Upload metadata is attacker-controlled and files can contain active or malicious content. |
| External URLs | Allow only required schemes and destinations; block private, loopback, and link-local network targets when the server fetches a user-provided URL. | Destination checks reduce server-side request forgery risk. |
| Persistence | Use Mongoose/schema validation and safe query construction; do not pass arbitrary user objects into database filters or update operators. | Database-level validation and constrained queries add defense beyond HTTP validation. |

## Secrets and environment configuration

| Secret/configuration | Rule | Reason |
|---|---|---|
| JWT signing keys, database credentials, AI-provider keys, Firebase service credentials | Inject through the deployment platform’s secret manager; use separate values per environment and least-privilege credentials. | Centralized, scoped secrets reduce accidental disclosure and limit blast radius. |
| Startup validation | Fail closed at startup if a required production secret is absent or weak; never provide a source-code fallback such as a default JWT key. | A hard failure is safer than silently running with a guessable credential. |
| Local development | Use an ignored `.env` file and a committed `.env.example` containing names and non-secret placeholders only; rotate any credential that is accidentally committed. | Developers can configure the app without putting usable secrets in version control. |
| Client configuration | Treat Firebase web configuration as public client configuration, not as a secret; lock it down with provider, domain, and API restrictions, and keep Admin SDK credentials server-side. | Public client identifiers do not authorize users; provider restrictions and server verification remain necessary. |
| Logs and errors | Never log passwords, tokens, cookies, authorization headers, reset links, database URIs, or secret values; return generic client errors and retain safe correlation IDs. | Redaction prevents logs and error responses from becoming a credential store. |
| Rotation and access | Restrict production secret access to the deployment identity and authorized operators; define documented rotation and incident-revocation procedures. | Least privilege and rehearsed rotation improve response to leaked credentials. |

## Launch security checklist

- [ ] Remove the implicit demo user and ensure every protected route rejects missing or invalid authentication.
- [ ] Remove all hard-coded secrets and fallback signing keys; validate required production environment variables at startup.
- [ ] Verify Firebase ID tokens server-side and reject client-supplied identity fields as authentication evidence.
- [ ] Implement email verification, password reset, magic-link expiry and single-use semantics, and session revocation.
- [ ] Replace the six-character password minimum; use Argon2id for new hashes and migrate existing hashes after successful login.
- [ ] Replace long-lived access JWTs in `localStorage` with short-lived in-memory access tokens and rotated, revocable refresh sessions in secure HttpOnly cookies.
- [ ] Enforce JWT signature, algorithm, issuer, audience, expiry, token type, and subject validation.
- [ ] Apply account- and IP-based rate limits to login, signup, reset, magic-link, refresh, uploads, and expensive generation endpoints.
- [ ] Configure production CORS allowlists, CSRF validation for cookie-authenticated state changes, HTTPS, secure cookies, and security headers.
- [ ] Audit every route for authentication, role checks, owner-scoped database access, and default-deny behavior.
- [ ] Validate all JSON, query, path, and upload inputs; test file limits, content checks, and private download authorization.
- [ ] Audit UI output for unsafe HTML rendering; verify CSP and contextual output handling.
- [ ] Verify secrets are absent from source, client bundles, logs, test fixtures, and deployment artifacts.
- [ ] Test account enumeration resistance, brute-force throttling, refresh-token replay, logout revocation, CSRF, XSS, and cross-user resource access.
- [ ] Review dependency vulnerabilities, database backups and access policies, audit logging, monitoring alerts, and incident-response/secret-rotation procedures.
- [ ] Run production build, type-check, authentication and authorization tests, and a deployment configuration review before release.
