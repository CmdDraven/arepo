import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { betterAuth } from "better-auth";

export const BETTER_AUTH_APP_DATA_STORE_PROOF_MOUNTED = false;
export const BETTER_AUTH_APP_DATA_STORE_PROOF_WIRED_INTO_AUTHORIZATION = false;
export const BETTER_AUTH_APP_DATA_STORE_PROOF_WIRED_INTO_ROUTES = false;
export const BETTER_AUTH_APP_DATA_STORE_PROOF_LIVE_BROWSER_AUTH_ENABLED = false;

export type BetterAuthAppDataStoreProofFindingStatus =
  "passed" | "accepted-with-conditions" | "needs-policy-review" | "needs-adapter-spike";

export type BetterAuthAppDataStoreProofFinding = {
  id:
    | "app-data-sqlite-initialization"
    | "schema-migration"
    | "session-lookup"
    | "session-expiry-filter"
    | "revoke-current"
    | "revoke-all"
    | "persistence-across-reopen"
    | "stored-session-token-policy"
    | "cleanup";
  status: BetterAuthAppDataStoreProofFindingStatus;
  summary: string;
  blockerCodes: readonly string[];
  openQuestions: readonly string[];
};

export type BetterAuthAppDataStoreProofResult = {
  status: "isolated-app-data-store-proof";
  packageName: "better-auth";
  storageEngine: "node-sqlite";
  addedDatabaseDependency: false;
  databaseLocation: "app-data/auth/better-auth.sqlite";
  liveBrowserAuthEnabled: false;
  mountedInServer: false;
  wiredIntoAuthorization: false;
  wiredIntoRoutes: false;
  emitsLiveSetCookieHeaders: false;
  acceptsCookieCredentialsInLiveAuth: false;
  changesBearerTokenProtectedMode: false;
  migrations: {
    runMigrationsAvailable: boolean;
    migrationsRan: boolean;
    tableNames: readonly string[];
    sessionColumnNames: readonly string[];
    schemaOwnershipDecisionNeeded: boolean;
  };
  storageProof: {
    databaseCreatedInAppData: boolean;
    databaseOutsideVault: true;
    persistedAcrossReopen: boolean;
    sessionLookupWorked: boolean;
    expiredSessionExcludedFromActiveLookup: boolean;
    revokeCurrentWorked: boolean;
    revokeAllForSubjectWorked: boolean;
    deterministicCleanupWorked: boolean;
    sessionTokenColumnPresent: boolean;
    storedSessionTokenPolicy: "accepted-with-conditions";
    backupResetCorruptionPolicyNeeded: true;
  };
  sessionConfig: {
    expirySeconds: number;
    refreshUpdateAgeSeconds: number;
  };
  findings: readonly BetterAuthAppDataStoreProofFinding[];
};

type DatabaseSyncLike = {
  prepare(sql: string): {
    all(...params: unknown[]): Array<Record<string, unknown>>;
  };
  close(): void;
};

type BetterAuthContextLike = {
  runMigrations(): Promise<void>;
  internalAdapter: {
    createUser(input: {
      email: string;
      name: string;
      emailVerified: boolean;
    }): Promise<{ id: string }>;
    createSession(
      userId: string,
      dontRememberMe?: boolean,
      override?: Record<string, unknown>,
    ): Promise<{ token: string; userId: string }>;
    findSession(token: string): Promise<unknown | null>;
    findSessions(
      tokens: readonly string[],
      options?: { onlyActiveSessions?: boolean },
    ): Promise<readonly unknown[]>;
    deleteSession(token: string): Promise<void>;
    deleteUserSessions(userId: string): Promise<void>;
  };
  sessionConfig: {
    expiresIn: number;
    updateAge: number;
  };
};

export type BetterAuthProofContext = {
  auth: {
    handler(request: Request): Promise<Response>;
    $context: Promise<BetterAuthContextLike>;
  };
  context: BetterAuthContextLike;
  database: DatabaseSyncLike;
  appDataDir: string;
  databasePath: string;
  databaseRelativePath: "auth/better-auth.sqlite";
  cleanup(): Promise<boolean>;
};

const baseUrl = "http://127.0.0.1:8734";

export async function createBetterAuthAppDataProofContext(
  options: {
    appDataDir?: string;
    emailAndPasswordEnabled?: boolean;
    plugins?: Parameters<typeof betterAuth>[0]["plugins"];
  } = {},
): Promise<BetterAuthProofContext> {
  const appDataDir = options.appDataDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "arepo-ba-")));
  const authDir = path.join(appDataDir, "auth");
  await fs.mkdir(authDir, { recursive: true });
  const databasePath = path.join(authDir, "better-auth.sqlite");
  const database = await openNodeSqliteDatabase(databasePath);
  const auth = betterAuth({
    secret: "arepo-better-auth-app-data-proof-secret-0123456789abcdef",
    baseURL: baseUrl,
    trustedOrigins: [baseUrl],
    database,
    emailAndPassword: { enabled: options.emailAndPasswordEnabled === true },
    socialProviders: {},
    plugins: options.plugins ?? [],
    rateLimit: { enabled: false },
    advanced: {
      useSecureCookies: false,
      cookies: {
        session_token: {
          name: "arepo_session",
          attributes: {
            httpOnly: true,
            sameSite: "lax",
            path: "/api",
          },
        },
      },
    },
    session: {
      expiresIn: 60 * 30,
      updateAge: 60 * 5,
    },
  }) as BetterAuthProofContext["auth"];
  const context = await auth.$context;

  return {
    auth,
    context,
    database,
    appDataDir,
    databasePath,
    databaseRelativePath: "auth/better-auth.sqlite",
    async cleanup() {
      database.close();
      await fs.rm(appDataDir, { recursive: true, force: true });
      return !(await pathExists(appDataDir));
    },
  };
}

export async function runIsolatedBetterAuthAppDataStoreProof(): Promise<BetterAuthAppDataStoreProofResult> {
  const first = await createBetterAuthAppDataProofContext();
  await first.context.runMigrations();
  const tableNames = sqliteStringColumn(
    first.database,
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  const sessionColumnNames = sqliteStringColumn(
    first.database,
    "PRAGMA table_info(session)",
    "name",
  );
  const user = await first.context.internalAdapter.createUser({
    email: "arepo-app-data-proof@example.invalid",
    name: "AREPO App Data Proof",
    emailVerified: true,
  });
  const firstSession = await first.context.internalAdapter.createSession(user.id);
  const secondSession = await first.context.internalAdapter.createSession(user.id);
  const expiredSession = await first.context.internalAdapter.createSession(user.id, false, {
    expiresAt: new Date(0),
  });
  first.database.close();

  const reopened = await createBetterAuthAppDataProofContext({ appDataDir: first.appDataDir });
  await reopened.context.runMigrations();
  const persistedSession = await reopened.context.internalAdapter.findSession(firstSession.token);
  const activeExpiredSessions = await reopened.context.internalAdapter.findSessions(
    [expiredSession.token],
    { onlyActiveSessions: true },
  );
  await reopened.context.internalAdapter.deleteSession(firstSession.token);
  const revokedCurrent = await reopened.context.internalAdapter.findSession(firstSession.token);
  await reopened.context.internalAdapter.deleteUserSessions(user.id);
  const revokedSecond = await reopened.context.internalAdapter.findSession(secondSession.token);
  const cleanupWorked = await reopened.cleanup();

  const result = {
    status: "isolated-app-data-store-proof",
    packageName: "better-auth",
    storageEngine: "node-sqlite",
    addedDatabaseDependency: false,
    databaseLocation: "app-data/auth/better-auth.sqlite",
    liveBrowserAuthEnabled: false,
    mountedInServer: false,
    wiredIntoAuthorization: false,
    wiredIntoRoutes: false,
    emitsLiveSetCookieHeaders: false,
    acceptsCookieCredentialsInLiveAuth: false,
    changesBearerTokenProtectedMode: false,
    migrations: {
      runMigrationsAvailable: typeof reopened.context.runMigrations === "function",
      migrationsRan: ["user", "session", "account", "verification"].every((table) =>
        tableNames.includes(table),
      ),
      tableNames,
      sessionColumnNames,
      schemaOwnershipDecisionNeeded: true,
    },
    storageProof: {
      databaseCreatedInAppData: true,
      databaseOutsideVault: true,
      persistedAcrossReopen: persistedSession !== null,
      sessionLookupWorked: persistedSession !== null,
      expiredSessionExcludedFromActiveLookup: activeExpiredSessions.length === 0,
      revokeCurrentWorked: revokedCurrent === null,
      revokeAllForSubjectWorked: revokedSecond === null,
      deterministicCleanupWorked: cleanupWorked,
      sessionTokenColumnPresent: sessionColumnNames.includes("token"),
      storedSessionTokenPolicy: "accepted-with-conditions",
      backupResetCorruptionPolicyNeeded: true,
    },
    sessionConfig: {
      expirySeconds: reopened.context.sessionConfig.expiresIn,
      refreshUpdateAgeSeconds: reopened.context.sessionConfig.updateAge,
    },
  } satisfies Omit<BetterAuthAppDataStoreProofResult, "findings">;

  return {
    ...result,
    findings: buildFindings(result),
  };
}

function buildFindings(
  result: Omit<BetterAuthAppDataStoreProofResult, "findings">,
): readonly BetterAuthAppDataStoreProofFinding[] {
  return [
    {
      id: "app-data-sqlite-initialization",
      status: result.storageProof.databaseCreatedInAppData ? "passed" : "needs-adapter-spike",
      summary: "Better Auth can initialize against a Node SQLite file under AREPO app data.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "schema-migration",
      status: result.migrations.migrationsRan ? "passed" : "needs-adapter-spike",
      summary: "Better Auth migrations create user, session, account, and verification tables.",
      blockerCodes: ["better-auth-schema-ownership-decision-needed"],
      openQuestions: [
        "Should AREPO own migration execution, reset, and corruption recovery policy?",
      ],
    },
    {
      id: "session-lookup",
      status: result.storageProof.sessionLookupWorked ? "passed" : "needs-adapter-spike",
      summary: "A session persisted in app-data SQLite can be looked up after reopening the store.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "session-expiry-filter",
      status: result.storageProof.expiredSessionExcludedFromActiveLookup
        ? "passed"
        : "needs-adapter-spike",
      summary: result.storageProof.expiredSessionExcludedFromActiveLookup
        ? "Better Auth can filter expired sessions from active session lookup."
        : "The isolated internal-adapter proof did not prove deterministic expired-session filtering.",
      blockerCodes: result.storageProof.expiredSessionExcludedFromActiveLookup
        ? []
        : ["deterministic-expiry-adapter-proof-needed"],
      openQuestions: [
        "Can AREPO prove expiry through Better Auth's supported request/session APIs or an accepted adapter clock strategy?",
      ],
    },
    {
      id: "revoke-current",
      status: result.storageProof.revokeCurrentWorked ? "passed" : "needs-adapter-spike",
      summary: "One selected session can be deleted from app-data SQLite.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "revoke-all",
      status: result.storageProof.revokeAllForSubjectWorked ? "passed" : "needs-adapter-spike",
      summary: "All sessions for one Better Auth user can be deleted from app-data SQLite.",
      blockerCodes: [],
      openQuestions: ["AREPO must map local operator subjects to Better Auth users deliberately."],
    },
    {
      id: "persistence-across-reopen",
      status: result.storageProof.persistedAcrossReopen ? "passed" : "needs-adapter-spike",
      summary: "Session state persists across a database close/reopen cycle.",
      blockerCodes: [],
      openQuestions: [],
    },
    {
      id: "stored-session-token-policy",
      status: "accepted-with-conditions",
      summary:
        "Better Auth's session table token column is accepted only under AREPO app-data storage conditions.",
      blockerCodes: ["better-auth-session-token-storage-mitigations-needed"],
      openQuestions: [
        "How should AREPO implement app-data permissions, backup/reset warnings, and corruption handling before live activation?",
      ],
    },
    {
      id: "cleanup",
      status: result.storageProof.deterministicCleanupWorked ? "passed" : "needs-adapter-spike",
      summary: "The isolated proof can clean up its temporary app-data store deterministically.",
      blockerCodes: [],
      openQuestions: [],
    },
  ];
}

async function openNodeSqliteDatabase(databasePath: string): Promise<DatabaseSyncLike> {
  const sqlite = (await import("node:sqlite")) as {
    DatabaseSync: new (filename: string) => DatabaseSyncLike;
  };
  return new sqlite.DatabaseSync(databasePath);
}

function sqliteStringColumn(
  database: DatabaseSyncLike,
  sql: string,
  column = "name",
): readonly string[] {
  return database
    .prepare(sql)
    .all()
    .map((row) => row[column])
    .filter((value): value is string => typeof value === "string")
    .sort();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
