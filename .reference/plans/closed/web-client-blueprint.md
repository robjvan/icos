# ICOS Web Client — Project Blueprint

---

## 1. Identity

- **Project title:** `ICOS web client`
- **One-line pitch:** `Web client for the ICOS v3 stack.`

- **Project type:**
  - [ ] e-commerce
  - [ ] mobile companion app
  - [ ] desktop app
  - [ ] IoT / embedded
  - [x] other: Chat/management web app
- **Primary users:**
  - [ ] customers / clients
  - [ ] admins
  - [ ] staff / operators
  - [ ] public visitors
  - [x] other: Self-hosted sole user

## 2. Styling

- **Theme:** [ ] dark  [ ] light  [x] both
- **BG color (dark theme):** `smoky granite` (spec: `#25282A` / similar)
- **BG color (light theme):** `lilac mist` (spec: `#E4E4E7` / similar)
- **Accent color:** `hawkesbury` (spec: `#6F8F82` / similar)
- **Secondary accent:** `Kimirucha brown` (spec: `#8A6D3B` / similar)
- **Error/destructive/urgent:** `upsed tomato` (spec: `#AF231C` / similar)
- **Fonts (Fontsource):** primary `Inter` — secondary `JetBrains Mono`
- **Typography scale:** [ ] modular preset — `Golden ratio`  [x] Tailwind default  [ ] Perfect fourth
- **Style:** [x] modern  [x] industrial  [ ] minimal  [ ] brutalist  [ ] glass  [ ] other
- **Animations & motion:** [ ] none / subtle  [ ] parallax  [ ] vanta.js  [ ] three.js (product previews)  [ ] framer-motion  [ ] gsap  [ ] lottie
- **Icons:** [x] lucide  [ ] fontawesome  [ ] remix  [ ] phosphor  [ ] tabler  [ ] other

## 3. Shared

- **Platforms to include**:
  - [ ] backend
  - [x] web frontend client
  - [ ] landing page
  - [ ] mobile app
  - [ ] desktop app
  - [ ] python workers
  - [ ] arduino / iot
- **Client connections / API protocols:** [ ] REST (OpenAPI)  [ ] GraphQL  [ ] gRPC  [ ] tRPC  [ ] WebSockets / SSE  [ ] other
- **Auth:** [ ] user accounts  [ ] admin + customers  [x] none  [ ] multi-role RBAC
- **Age restrictions:** [x] none  [ ] 13+  [ ] 18+
- **Features:**
  - [x] Chat UI to interact with server
  - [x] Session history sidebar
  - [x] Tabbed navigation (tabs along top above chat window)
    - [x] agents tab
    - [x] tools tab (toggle, auto-approve tools in frontend; unimplemented in server, placeholder in frontend)
    - [x] skills tab (CRUD skills from frontend; unimplemented in server, placeholder required in frontend)
    - [x] Client settings tab (frontend settings only?)
    - [x] Server settings tab (server settings only?)
    - [x] identity management? (SOUL.md, persona, system prompt, etc.)
    - [x] model tab/setting (set model from frontend, server tab? unimplemented in server, placeholder required in frontend)
    - [x] cron job management (unimplemented in server, placeholder required in frontend)
    - [x] generated files (images, etc; persistence unimplemented in server, placeholder in frontend)
    - [x] kb management (incl. "upload to kb", kb entirely unimplemented in server, placeholder required in frontend)
    - [x] "sensors" (unimplemented in server, placeholder required in frontend)
    - [x] Memory management (candidates, searchable memories?, contradictions, etc; unimplemented in server, placeholder required in frontend)
    - [x] MCP Server management (unimplemented in server, placeholder required in frontend)
    - [x] SMS/Email/Discord settings
    - [x] Only features for milestones M16 and under for now. M17 and onward is for the next major phase of the web client.
  - [x] "Floating" UI - windows are disconnected with small gap around
  - [x] System health footer bar
  - [x] file uploads (photos, docs, etc as prompt input; unimplemented in server, placeholder required in frontend)
  - [x] search/filters (session search?)
  - [x] metrics/analytics (unimplemented in server, placeholder required in frontend)
    - [x] provider-style token usage over time: tokens, est. cost, etc by day with today/7d/30d/90d and custom ranges
    - [x] wakatime-style per-project tracking if feasible: time spent, additions/deletions, etc.

- **Upload types:** [ ] none  [x] images  [x] docs  [x] audio/video
- **Monetization:** [x] none  [ ] one-time payments  [ ] subscriptions  [ ] quotes/invoicing
- **Logging & observability:** [ ] Winston  [ ] Pino  [ ] Sentry  [ ] OpenTelemetry  [ ] Prometheus
- **Error handling:** [x] custom exception filters  [ ] Result/Either  [ ] centralized boundaries
- **JSDoc comments:** [ ] yes  [ ] no
- **Swagger / OpenAPI decorators:** [ ] yes  [ ] no
- **Testing bar:** [x] unit where useful  [x] integration critical flows  [x] E2E important flows
- **Languages / localization:** primary `en`, secondary `fr`, others: `es`, `pa`, `zh`
- **Text direction:** [x] LTR  [ ] RTL required
- **a11y target:** [ ] standard  [x] WCAG 2.1 AA
- **Env var management:** [ ] standard `.env` per app  [ ] centralized secrets
- **Config validation:** [ ] strict runtime validation (zod / class-validator)  [x] none
- **Security headers:** [x] standard CORS  [x] CSP  [x] rate limiting  [x] encryption at rest (pgcrypto/disk)
- **Data compliance:** [ ] GDPR  [ ] PIPEDA  [ ] HIPAA
- **Data privacy:** [ ] account deletion  [ ] data export
- **Repository structure:** [ ] monorepo  [ ] separate repos
- **Commit / push cadence:** `commits per-phase, NO pushing`
- **API client / contract approach:** [ ] OpenAPI / typelink-driven + shared contracts package
- **Auth state & sessions:** [ ] cookie-based  [ ] token-based (JWT, in-memory/secure storage)

## 5. Web Frontend

- **Framework:** [x] Angular  [ ] React  [ ] Vue  [ ] Svelte/SvelteKit
- **State management:** [x] Signals (Angular)  [ ] NgRx  [ ] other
- **Data fetching:** [x] RxJS/HTTP services  [ ] TanStack Query
- **Component library:** [ ] PrimeNG  [x] standalone Tailwind  [ ] shadcn
- **Optional rules (Angular):** [x] standalone components only  [x] no `effect()` unless allowed  [x] separate .html/.css/.ts
- **Caching / hydration:** [x] client-side SPA, local state caching  [ ] SSR
- **Deployment:** [x] Coolify (self-hosted)  [ ] Vercel  [ ] Netlify

## 7. Infrastructure / Deployment

- **Git host:** [x] GitHub  [x] Forgejo  [ ] GitLab  [ ] Codeberg
- **Containerization:** [x] Dockerfile (multi-stage)  [ ] Docker Compose  [ ] Kubernetes
- **CI/CD:** [ ] GitHub Actions  [x] Coolify  [ ] none
- **File / object storage:** [ ] local disk (v1, package cache by request hash)  [ ] AWS S3  [ ] R2  [ ] MinIO  [x] VersityGW (unimplemented at time of blueprint creation)
- **Monitoring / health:** [x] `/health` + Coolify probes  [x] structured request logging (request-id)

## 9. Signature

Filled by: -- Date: 2026-09-21
Once signed, this blueprint is the top of the source-of-truth hierarchy for the ICOS v3 web client build.

## Addendum

In addition to the constraints in the prior files, follow these as well:

- for an angular component create a dir and use separate HTML, CSS, and TS files, do not create a monolithic "component.ts" that contains everything.
  - example: `NavbarComponent` might live in `/app/shared/components/navbar/navbar.ts` with navbar.html and navbar.css files alongside.
- use the UI mockup as a guide for the layout and styling of the project.
- use tailwindCSS, primeng components when needed.
- use a `SERVER_URL` var to ping backend endpoints so the endpoint URL is something like `${SERVER_URL}${AUTH_ENDPOINT}/login`.
- store `SERVER_URL` and all `*_ENDPOINT` const vars in a central `constants.ts` file.
- use lazy loading for components.
