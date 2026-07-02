import type {
  ProtectedRoutePolicy,
  RoutePermission,
  StrongerConfirmation,
} from "./routePermissions.js";

export type PlannedActorKind = "session" | "device" | "node" | "api";

export type AnonymousPlanningActor = {
  kind: "anonymous";
};

export type CredentialPlanningActor = {
  kind: "credential";
  credentialId: string;
  displayName: string;
  actorKind: PlannedActorKind;
  nodePermissions?: readonly RoutePermission[];
  vaultGrants?: readonly VaultPermissionGrant[];
};

export type AuthPlanningActor = AnonymousPlanningActor | CredentialPlanningActor;

export type VaultPermissionGrant = {
  vaultId: string;
  permissions: readonly RoutePermission[];
};

export type AuthPlanningInput = {
  policy?: ProtectedRoutePolicy | null;
  actor?: AuthPlanningActor | null;
  vaultId?: string;
};

export type AuthPlanDecision = "allow" | "deny" | "anonymous-reduced" | "requires-confirmation";

export type AuthPlanResult = {
  decision: AuthPlanDecision;
  requiredPermissions: readonly RoutePermission[];
  missingPermissions: readonly RoutePermission[];
  requiredConfirmation: readonly StrongerConfirmation[];
  networkExposureSafe: false;
  reason: string;
};

const nodeLevelPermissions = new Set<RoutePermission>([
  "manageVaults",
  "manageNode",
  "manageAuth",
  "readAudit",
]);

export function planProtectedRouteAuthorization(input: AuthPlanningInput): AuthPlanResult {
  const policy = input.policy;
  if (!policy) {
    return deny([], [], "No route policy was supplied.");
  }

  if (policy.networkExposureSafe !== false) {
    return deny(
      policy.requiredPermissions,
      policy.requiredPermissions,
      "Route policy is not safe.",
    );
  }

  const actor = input.actor;
  if (!actor) {
    return deny(
      policy.requiredPermissions,
      policy.requiredPermissions,
      "No planning actor was supplied.",
    );
  }

  if (actor.kind === "anonymous") {
    if (policy.anonymousReducedStatusMayExist) {
      return {
        decision: "anonymous-reduced",
        requiredPermissions: policy.requiredPermissions,
        missingPermissions: policy.requiredPermissions,
        requiredConfirmation: [],
        networkExposureSafe: false,
        reason: "Only a reduced anonymous response may be planned for this route.",
      };
    }
    return deny(
      policy.requiredPermissions,
      policy.requiredPermissions,
      "Anonymous actors are denied.",
    );
  }

  if (!isValidCredential(actor)) {
    return deny(
      policy.requiredPermissions,
      policy.requiredPermissions,
      "Credential actor is malformed.",
    );
  }

  const missingPermissions = missingRequiredPermissions(policy, actor, input.vaultId);
  if (missingPermissions.length > 0) {
    return deny(
      policy.requiredPermissions,
      missingPermissions,
      "Credential is missing required permissions.",
    );
  }

  if (policy.strongerConfirmation.length > 0) {
    return {
      decision: "requires-confirmation",
      requiredPermissions: policy.requiredPermissions,
      missingPermissions: [],
      requiredConfirmation: policy.strongerConfirmation,
      networkExposureSafe: false,
      reason: "Credential has permissions, but this route requires stronger confirmation.",
    };
  }

  return {
    decision: "allow",
    requiredPermissions: policy.requiredPermissions,
    missingPermissions: [],
    requiredConfirmation: [],
    networkExposureSafe: false,
    reason: "Credential has the required planned permissions.",
  };
}

function missingRequiredPermissions(
  policy: ProtectedRoutePolicy,
  actor: CredentialPlanningActor,
  vaultId?: string,
): RoutePermission[] {
  const missing: RoutePermission[] = [];
  for (const permission of policy.requiredPermissions) {
    if (nodeLevelPermissions.has(permission)) {
      if (!hasNodePermission(actor, permission)) missing.push(permission);
      continue;
    }

    if (policy.routePattern === "/api/vaults" && permission === "readIndex") {
      if (!hasAnyVaultPermission(actor, permission)) missing.push(permission);
      continue;
    }

    if (!vaultId || !hasVaultPermission(actor, vaultId, permission)) {
      missing.push(permission);
    }
  }
  return missing;
}

function hasNodePermission(actor: CredentialPlanningActor, permission: RoutePermission): boolean {
  return actor.nodePermissions?.includes(permission) ?? false;
}

function hasAnyVaultPermission(
  actor: CredentialPlanningActor,
  permission: RoutePermission,
): boolean {
  return actor.vaultGrants?.some((grant) => grant.permissions.includes(permission)) ?? false;
}

function hasVaultPermission(
  actor: CredentialPlanningActor,
  vaultId: string,
  permission: RoutePermission,
): boolean {
  return (
    actor.vaultGrants?.some(
      (grant) => grant.vaultId === vaultId && grant.permissions.includes(permission),
    ) ?? false
  );
}

function isValidCredential(actor: CredentialPlanningActor): boolean {
  return Boolean(actor.credentialId.trim() && actor.displayName.trim() && actor.actorKind);
}

function deny(
  requiredPermissions: readonly RoutePermission[],
  missingPermissions: readonly RoutePermission[],
  reason: string,
): AuthPlanResult {
  return {
    decision: "deny",
    requiredPermissions,
    missingPermissions,
    requiredConfirmation: [],
    networkExposureSafe: false,
    reason,
  };
}
