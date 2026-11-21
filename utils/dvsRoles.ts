/**
 * DVS role workspace inventory.
 * @description Sidebar modules verified per role in prompts/KTR_WEB_TEST_PROMPTS.md §21.
 */

export type DvsRole =
  | "admin"
  | "chairman"
  | "chief"
  | "evaluator"
  | "scanner_operator"
  | "user_manager";

export type DvsRoleDefinition = {
  role: DvsRole;
  label: string;
  modules: readonly string[];
};

export const DVS_ROLES: readonly DvsRoleDefinition[] = [
  {
    role: "admin",
    label: "Admin",
    modules: ["Exam configuration", "Marking schemes", "Access governance"],
  },
  {
    role: "chairman",
    label: "Chairman",
    modules: ["Chief nominations", "Chief master"],
  },
  {
    role: "chief",
    label: "Chief Examiner",
    modules: [
      "Allocation engine",
      "Evaluator master",
      "Manage team",
      "Attendance",
      "Moderation",
      "Moderation reports",
      "Live monitoring",
    ],
  },
  {
    role: "evaluator",
    label: "Evaluator",
    modules: ["Evaluation desk"],
  },
  {
    role: "scanner_operator",
    label: "Scanner Operator",
    modules: ["Digitization"],
  },
  {
    role: "user_manager",
    label: "User Manager",
    modules: ["User management"],
  },
];

/**
 * Platform control-plane roles. Kept separate from `DVS_ROLES` because the
 * platform console is a different origin and is not part of the tenant login matrix.
 */
export type PlatformRoleDefinition = {
  role: "platform_admin";
  label: string;
  modules: readonly string[];
};

export const PLATFORM_ROLES: readonly PlatformRoleDefinition[] = [
  {
    role: "platform_admin",
    label: "Platform administrator",
    modules: ["Universities"],
  },
];

/** Resolves one role definition; throws for a role the UI does not expose. */
export function getDvsRoleDefinition(role: string): DvsRoleDefinition {
  const definition = DVS_ROLES.find((candidate) => candidate.role === role);
  if (!definition) {
    throw new Error(`Unknown DVS role: ${role}`);
  }
  return definition;
}
