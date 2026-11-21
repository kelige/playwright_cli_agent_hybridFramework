/**
 * Platform control-plane routes.
 *
 * These are served by the platform console origin (`PLATFORM_URL`), not by a
 * university tenant. Verified against the live Django URLconf and OpenAPI
 * document on the platform host. Do not add routes that were not observed.
 */

export const PLATFORM_API_BASE_URL = (
  process.env.PLATFORM_API_BASE_URL ??
  process.env.PLATFORM_URL ??
  ""
).replace(/\/+$/, "");

export const PlatformRoutes = {
  ENTERPRISE_TENANTS: "/api/v1/enterprise/tenants", // GET, POST
  ENTERPRISE_TENANT_SWITCH: "/api/v1/enterprise/tenants/switch", // POST
  ENTERPRISE_TENANT: "/api/v1/enterprise/tenants/{tenantId}", // PATCH
  ENTERPRISE_TENANT_ADMIN_RESET:
    "/api/v1/enterprise/tenants/{tenantId}/administrator/reset-password", // POST
  ENTERPRISE_CONTROL_PLANE: "/api/v1/enterprise/control-plane", // GET
  ENTERPRISE_CONTROL_PLANE_AUDIT: "/api/v1/enterprise/control-plane/audit", // GET
  ENTERPRISE_INSTITUTIONS: "/api/v1/enterprise/institutions", // GET, POST
  ENTERPRISE_DOMAIN_CONTEXT: "/api/v1/enterprise/domain-context", // GET
  AUTH_LOGIN: "/api/v1/auth/login", // POST
  AUTH_ME: "/api/v1/auth/me", // GET
  AUTH_PASSWORD_COMPLETE_SETUP: "/api/v1/auth/password/complete-setup", // POST
} as const;

export const PlatformRouteMethods = {
  ENTERPRISE_TENANTS: "GET/POST",
  ENTERPRISE_TENANT_SWITCH: "POST",
  ENTERPRISE_TENANT: "PATCH",
  ENTERPRISE_TENANT_ADMIN_RESET: "POST",
  ENTERPRISE_CONTROL_PLANE: "GET",
  ENTERPRISE_CONTROL_PLANE_AUDIT: "GET",
  ENTERPRISE_INSTITUTIONS: "GET/POST",
  ENTERPRISE_DOMAIN_CONTEXT: "GET",
  AUTH_LOGIN: "POST",
  AUTH_ME: "GET",
  AUTH_PASSWORD_COMPLETE_SETUP: "POST",
} as const;

export const PlatformRouteBuilders = {
  tenant: (tenantId: string) =>
    `/api/v1/enterprise/tenants/${encodeURIComponent(tenantId)}`,
  tenantAdminReset: (tenantId: string) =>
    `/api/v1/enterprise/tenants/${encodeURIComponent(tenantId)}/administrator/reset-password`,
  controlPlaneAudit: (limit = 100) =>
    `/api/v1/enterprise/control-plane/audit?limit=${limit}`,
} as const;

/** Matches the create-tenant request the console issues when a university is provisioned. */
export const PROVISION_TENANT_PATH = "/api/v1/enterprise/tenants";
