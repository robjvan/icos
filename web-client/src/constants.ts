// Backend base URL. The core serves `/core/*` endpoints; the web client runs
// on a different origin (:4200 vs :3000) and relies on core's permissive CORS
// in local dev. NOTE: `localhost` inside a container is the container itself —
// when running under docker compose or across the LAN, point SERVER_URL at
// `host.docker.internal` or the host's LAN address instead.
export const SERVER_URL = 'http://localhost:3000';

// Core endpoint paths (relative). Compose as `${SERVER_URL}${*_ENDPOINT}...`.
export const CONVERSATION_ENDPOINT = '/core/conversation';
export const ATTACHMENTS_ENDPOINT = '/core/attachments';
export const SESSIONS_ENDPOINT = '/core/sessions';
export const APPROVALS_ENDPOINT = '/core/approvals';
export const CLARIFICATIONS_ENDPOINT = '/core/clarifications';
export const MEMORY_CANDIDATES_ENDPOINT = '/core/memory-candidates';
export const PROMOTIONS_ENDPOINT = '/core/promotions';
export const CLAIMS_ENDPOINT = '/core/claims';
export const PROSPECTIVE_ENDPOINT = '/core/prospective';
export const SKILLS_ENDPOINT = '/core/skills';
export const HEALTH_ENDPOINT = '/core/health';
export const PERSONA_ENDPOINT = '/core/persona';

// Management surfaces (security S5).
export const MCP_ENDPOINT = '/core/mcp';
export const PROVIDERS_ENDPOINT = '/core/providers';
export const SECRETS_ENDPOINT = '/core/secrets';
export const SECURITY_ENDPOINT = '/core/security';

// Authentication (S2). The session lives in an httpOnly cookie, so every
// request must carry credentials; mutating requests echo the CSRF cookie.
export const AUTH_LOGIN_ENDPOINT = '/core/auth/login';
export const AUTH_LOGOUT_ENDPOINT = '/core/auth/logout';
export const AUTH_SESSION_ENDPOINT = '/core/auth/session';

/** Approval action for candidate → belief promotion (mirrors core PROMOTE_ACTION). */
export const MEMORY_PROMOTE_ACTION = 'memory.promote';
