import http from "node:http";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import { addVault, loadConfig, resolveAppDataDir, updateVaultIndexScope } from "./config.js";
import {
  bootstrapBearerCredential,
  createBearerCredential,
  listCredentials,
  revokeCredential,
  rotateCredential,
} from "./credentialLifecycle.js";
import { buildIndexFilterResponse, parseIndexFilterKind } from "./indexFilters.js";
import { buildVaultInspectResponse } from "./indexInspect.js";
import { buildIndexSearchResponse } from "./indexSearch.js";
import { rebuildMachineIndex } from "./indexCache.js";
import {
  getLocalNodeHealth,
  getLocalNodeInfo,
  getLocalNodeRuntimeStatus,
  getLocalVault,
  startLocalNode,
} from "./nodeService.js";
import {
  configuredAllowedOrigins as configuredAllowedOriginsFromEnv,
  resolveBackendRuntimeOptions,
} from "./nodeRuntime.js";
import { getVaultStorageSummary } from "./storage.js";
import { enforceProtectedMode } from "./protectedModeEnforcement.js";
import {
  getProtectedRequestDryRunCanaryStatus,
  runProtectedRequestDryRun,
} from "./protectedRequestDryRun.js";
import { removeVault } from "./vaultLifecycle.js";
import {
  beginVaultIndexBuildBestEffort,
  getVaultRuntimeStatus,
  recordVaultIndexedAfterPublication,
  recordVaultMutation,
  stopAllVaultWatchers,
} from "./vaultWatch.js";
import {
  createVaultFile,
  createVaultFolder,
  deleteVaultFile,
  listFolders,
  listSupportedTextFiles,
  readVaultFile,
  renameVaultPath,
  writeVaultFile,
} from "./vaultFs.js";
import { requireAvailableVault } from "./vaultAvailability.js";
import { rebindVaultRoot } from "./vaultRelocation.js";
import { projectVaultList } from "./vaultListVisibility.js";
import { apiErrorResponse, PublicApiError } from "./publicApiError.js";
import { browseServerDirectories } from "./directoryBrowser.js";
import type { VaultIndexResponse, VaultInfo } from "./types.js";

export type RequestLike = Pick<http.IncomingMessage, "method" | "url" | "headers"> &
  AsyncIterable<Buffer> & {
    socket?: Pick<http.IncomingMessage["socket"], "remoteAddress">;
  };

export type ResponsePayload = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export async function routeRequest(
  request: RequestLike,
  cwd = process.cwd(),
): Promise<ResponsePayload> {
  const method = request.method ?? "GET";
  let responseHeaders: Record<string, string> | undefined;

  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    const segments = url.pathname.split("/").filter(Boolean);
    const cors = corsHeaders(request);
    responseHeaders = cors.headers;

    if (!cors.allowed) {
      return json(
        403,
        {
          ok: false,
          error: "Origin is not allowed by AREPO local backend CORS policy",
        },
        cors.headers,
      );
    }

    if (method === "OPTIONS") {
      return json(204, null, cors.headers);
    }

    if (isInactiveBrowserSessionAuthRoute(method, url.pathname)) {
      return json(501, inactiveBrowserSessionAuthBody(), cors.headers);
    }

    const protectedMode = await enforceProtectedMode({
      request,
      cwd,
      url,
      corsHeaders: cors.headers,
    });
    if (protectedMode.response) return protectedMode.response;

    await runProtectedRequestDryRun({ request, cwd, url });

    if (method === "GET" && url.pathname === "/api/health") {
      return json(200, await getLocalNodeHealth(cwd), cors.headers);
    }

    if (method === "GET" && url.pathname === "/api/node/status") {
      return json(200, await getLocalNodeRuntimeStatus(cwd), cors.headers);
    }

    if (method === "GET" && url.pathname === "/api/node/auth/dry-run") {
      const config = await loadConfig(cwd);
      return json(200, getProtectedRequestDryRunCanaryStatus(config.auth), cors.headers);
    }

    if (method === "GET" && url.pathname === "/api/node/directories") {
      return json(200, await browseServerDirectories(url.searchParams.get("path")), cors.headers);
    }

    if (segments[0] === "api" && segments[1] === "node" && segments[2] === "credentials") {
      const config = await loadConfig(cwd);
      if (config.auth.mode !== "protected") {
        return json(
          404,
          { ok: false, error: "Credential lifecycle is only available in protected mode." },
          cors.headers,
        );
      }
      const appDataDir = resolveAppDataDir(config, cwd);
      const vaultRoots = config.vaults.map((vault) => vault.rootPath);

      if (method === "POST" && segments[3] === "bootstrap") {
        const body = asRecord(await readJson(request));
        const data = await bootstrapBearerCredential({
          appDataDir,
          vaultRoots,
          vaults: config.vaults,
          body,
        });
        return json(201, { ok: true, data }, cors.headers);
      }

      if (method === "GET" && segments[3] === undefined) {
        const data = await listCredentials({ appDataDir, vaultRoots });
        return json(200, { ok: true, data }, cors.headers);
      }

      if (method === "POST" && segments[3] === undefined) {
        const body = asRecord(await readJson(request));
        const data = await createBearerCredential({
          appDataDir,
          vaultRoots,
          vaults: config.vaults,
          body,
        });
        return json(201, { ok: true, data }, cors.headers);
      }

      if (method === "POST" && segments[3] && segments[4] === "revoke") {
        const body = asRecord(await readJson(request));
        const data = await revokeCredential({
          appDataDir,
          vaultRoots,
          credentialId: decodeURIComponent(segments[3]),
          reason: typeof body.reason === "string" ? body.reason : undefined,
        });
        return json(200, { ok: true, data }, cors.headers);
      }

      if (method === "POST" && segments[3] && segments[4] === "rotate") {
        const body = asRecord(await readJson(request));
        const data = await rotateCredential({
          appDataDir,
          vaultRoots,
          credentialId: decodeURIComponent(segments[3]),
          body,
        });
        return json(201, { ok: true, data }, cors.headers);
      }
    }

    if (method === "GET" && url.pathname === "/api/vaults") {
      const node = await getLocalNodeInfo(cwd);
      return json(200, projectVaultList(node, protectedMode.vaultListAccess), cors.headers);
    }

    if (method === "POST" && url.pathname === "/api/vaults") {
      const body = await readJson(request);
      const vault = await addVault(asRecord(body), cwd);
      await rebuildTrackedMachineIndex(vault, cwd);
      return json(201, { ok: true, data: { vault } }, cors.headers);
    }

    if (segments[0] === "api" && segments[1] === "vaults" && segments[2]) {
      const vaultId = decodeURIComponent(segments[2]);
      const action = segments[3];

      if (method === "DELETE" && action === undefined) {
        const body = asRecord(await readJson(request));
        const data = await removeVault(
          {
            vaultId,
            generatedDataAction: body.generatedDataAction,
          },
          cwd,
        );
        return json(200, { ok: true, data }, cors.headers);
      }

      if (method === "POST" && action === "rebind") {
        const body = asRecord(await readJson(request));
        const data = await rebindVaultRoot(vaultId, body.rootPath, cwd);
        return json(200, { ok: true, data }, cors.headers);
      }

      const vault = await requireAvailableVault(await getLocalVault(vaultId, cwd));

      if (method === "GET" && action === "files") {
        const [files, folders] = await Promise.all([
          listSupportedTextFiles(vault),
          listFolders(vault),
        ]);
        return json(200, { files, folders }, cors.headers);
      }

      if (method === "GET" && action === "file") {
        return json(200, await readVaultFile(vault, url.searchParams.get("path")), cors.headers);
      }

      if (method === "GET" && action === "status") {
        return json(
          200,
          await getVaultRuntimeStatus(vault, cwd, url.searchParams.get("path")),
          cors.headers,
        );
      }

      if (method === "GET" && action === "storage") {
        return json(200, await getVaultStorageSummary(vault, cwd), cors.headers);
      }

      if (method === "PUT" && action === "file") {
        const body = asRecord(await readJson(request));
        const data = await writeVaultFile(vault, url.searchParams.get("path"), body.content, {
          expectedHash: body.expectedHash,
          expectedMtimeMs: body.expectedMtimeMs,
        });
        await recordVaultMutation(vault, cwd);
        return json(200, { ok: true, data }, cors.headers);
      }

      if (method === "POST" && action === "file") {
        const body = asRecord(await readJson(request));
        const content = typeof body.content === "string" ? body.content : initialNote(body.path);
        const data = await createVaultFile(vault, body.path, content);
        await recordVaultMutation(vault, cwd);
        return json(201, { ok: true, data }, cors.headers);
      }

      if (method === "POST" && action === "folder") {
        const body = asRecord(await readJson(request));
        const data = await createVaultFolder(vault, body.path);
        await recordVaultMutation(vault, cwd);
        return json(201, { ok: true, data }, cors.headers);
      }

      if (method === "POST" && action === "rename") {
        const body = asRecord(await readJson(request));
        const data = await renameVaultPath(
          vault,
          body.fromPath,
          body.toPath,
          body.kind === "folder" ? "folder" : "file",
        );
        await recordVaultMutation(vault, cwd);
        return json(200, { ok: true, data }, cors.headers);
      }

      if (method === "DELETE" && action === "file") {
        const data = await deleteVaultFile(vault, url.searchParams.get("path"));
        await recordVaultMutation(vault, cwd);
        return json(200, { ok: true, data }, cors.headers);
      }

      if (method === "POST" && action === "reindex") {
        const data = await rebuildTrackedMachineIndex(vault, cwd);
        return json(200, { ok: true, data }, cors.headers);
      }

      if (method === "PATCH" && action === "index-scope") {
        const body = asRecord(await readJson(request));
        const updatedVault = await updateVaultIndexScope(vaultId, body.vaultIndexScope, cwd);
        const data = await rebuildTrackedMachineIndex(updatedVault, cwd);
        return json(200, { ok: true, data: { vault: updatedVault, index: data } }, cors.headers);
      }

      if (method === "GET" && action === "index" && segments[4] === "filters") {
        const data = await rebuildTrackedMachineIndex(vault, cwd);
        return json(
          200,
          buildIndexFilterResponse(data, parseIndexFilterKind(url.searchParams.get("filter"))),
          cors.headers,
        );
      }

      if (method === "GET" && action === "index" && segments[4] === "search") {
        const data = await rebuildTrackedMachineIndex(vault, cwd);
        return json(200, buildIndexSearchResponse(data, url.searchParams.get("q")), cors.headers);
      }

      if (method === "GET" && action === "index" && segments[4] === "inspect") {
        const data = await rebuildTrackedMachineIndex(vault, cwd);
        return json(
          200,
          buildVaultInspectResponse(data, url.searchParams.get("path")),
          cors.headers,
        );
      }

      if (method === "GET" && action === "index") {
        const data = await rebuildTrackedMachineIndex(vault, cwd);
        return json(200, data, cors.headers);
      }
    }

    return json(404, { ok: false, error: "Not found" }, cors.headers);
  } catch (error) {
    const failure = apiErrorResponse(error);
    return json(failure.status, failure.body, responseHeaders);
  }
}

export function createServer(cwd = process.cwd()): http.Server {
  return http.createServer(async (request, response) => {
    const result = await routeRequest(request, cwd);
    response.writeHead(result.status, {
      ...(result.body === null ? {} : { "content-type": "application/json; charset=utf-8" }),
      "cache-control": "no-store",
      ...(result.headers ?? {}),
    });
    response.end(result.body === null ? undefined : JSON.stringify(result.body));
  });
}

async function readJson(request: AsyncIterable<Buffer>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new PublicApiError(400, "Request body must contain valid JSON.", {
      code: "invalid-request-body",
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function rebuildTrackedMachineIndex(
  vault: VaultInfo,
  cwd: string,
): Promise<VaultIndexResponse> {
  const observation = await beginVaultIndexBuildBestEffort(vault, cwd);
  const data = await rebuildMachineIndex(vault, cwd);
  if (observation) {
    await recordVaultIndexedAfterPublication(vault, observation, cwd);
  }
  return data;
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ResponsePayload {
  return { status, body, headers };
}

function isInactiveBrowserSessionAuthRoute(method: string, pathname: string): boolean {
  return (
    (method === "POST" && pathname === "/api/node/auth/session") ||
    (method === "POST" && pathname === "/api/node/auth/session/logout") ||
    (method === "POST" && pathname === "/api/node/auth/session/revoke-all") ||
    (method === "GET" && pathname === "/api/node/auth/csrf") ||
    (method === "POST" && pathname === "/api/node/auth/pairing/start") ||
    (method === "POST" && pathname === "/api/node/auth/pairing/complete")
  );
}

function inactiveBrowserSessionAuthBody(): ResponsePayload["body"] {
  return {
    ok: false,
    error: {
      code: "browser_session_auth_inactive",
      message: "Browser-session authentication is planned but not active.",
    },
  };
}

function corsHeaders(request: RequestLike): {
  allowed: boolean;
  headers: Record<string, string>;
} {
  const origin = headerValue(request.headers?.origin);
  const headers = {
    vary: "Origin",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers":
      "authorization,content-type,x-arepo-confirmation,x-arepo-csrf,x-csrf-token",
    "access-control-max-age": "600",
  };
  if (!origin) return { allowed: true, headers };
  const allowedOrigins = configuredAllowedOrigins();
  if (!allowedOrigins.includes(origin)) return { allowed: false, headers };
  return {
    allowed: true,
    headers: {
      ...headers,
      "access-control-allow-origin": origin,
    },
  };
}

function configuredAllowedOrigins(): string[] {
  return configuredAllowedOriginsFromEnv();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function initialNote(rawPath: unknown): string {
  const path = typeof rawPath === "string" ? rawPath : "untitled.md";
  const slug = path.split("/").pop()?.replace(/\.md$/i, "") || "untitled";
  return `---\nid: ${slug}\ntitle: ${slug}\ntags: []\n---\n\n# ${slug}\n\n`;
}

async function main(): Promise<void> {
  await startLocalNode();
  const runtime = resolveBackendRuntimeOptions();
  if (runtime.nonLocalWarning) console.warn(runtime.nonLocalWarning);
  const { host, port } = runtime;
  const server = createServer();
  const shutdown = () => {
    stopAllVaultWatchers();
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.listen(port, host, () => {
    console.log(`AREPO backend listening on http://${host}:${port}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
