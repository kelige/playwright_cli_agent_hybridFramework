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

/** Resolves one role definition; throws for a role the UI does not expose. */
export function getDvsRoleDefinition(role: string): DvsRoleDefinition {
  const definition = DVS_ROLES.find((candidate) => candidate.role === role);
  if (!definition) {
    throw new Error(`Unknown DVS role: ${role}`);
  }
  return definition;
}
