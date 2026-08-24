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
import { getMachineIndex, rebuildMachineIndex } from "./indexCache.js";
import {
  getLocalNodeHealth,
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
  getVaultRuntimeStatus,
  recordVaultIndexed,
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
  const url = new URL(request.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);
  const cors = corsHeaders(request);

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

  try {
    if (isInactiveBrowserSessionAuthRoute(method, url.pathname)) {
      return json(501, inactiveBrowserSessionAuthBody(), cors.headers);
    }

    const protectedModeResponse = await enforceProtectedMode({
      request,
      cwd,
      url,
      corsHeaders: cors.headers,
    });
    if (protectedModeResponse) return protectedModeResponse;

    await runProtectedRequestDryRun({ request, cwd, url });

    if (method === "GET" && url.pathname === "/api/health") {
      return json(200, await getLocalNodeHealth(cwd), cors.headers);
    }

    if (method === "GET" && url.pathname === "/api/node/status") {
      return json(200, await getLocalNodeRuntimeStatus(cwd), cors.headers);
    }

    if (method === "GET" && url.pathname === "/api/node/auth/dry-run") {
      const config = await loadConfig(cwd, { validateVaultRoots: false });
      return json(200, getProtectedRequestDryRunCanaryStatus(config.auth), cors.headers);
    }

    if (segments[0] === "api" && segments[1] === "node" && segments[2] === "credentials") {
      const config = await loadConfig(cwd, { validateVaultRoots: false });
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
      const config = await loadConfig(cwd, { validateVaultRoots: false });
      const node = { ...config.node, vaults: config.vaults };
      return json(200, node, cors.headers);
    }

    if (method === "POST" && url.pathname === "/api/vaults") {
      const body = await readJson(request);
      const vault = await addVault(asRecord(body), cwd);
      await rebuildMachineIndex(vault, cwd);
      await recordVaultIndexed(vault, cwd);
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

      const vault = await getLocalVault(vaultId, cwd);

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
        const data = await rebuildMachineIndex(vault, cwd);
        await recordVaultIndexed(vault, cwd);
        return json(200, { ok: true, data }, cors.headers);
      }

      if (method === "PATCH" && action === "index-scope") {
        const body = asRecord(await readJson(request));
        const updatedVault = await updateVaultIndexScope(vaultId, body.vaultIndexScope, cwd);
        const data = await rebuildMachineIndex(updatedVault, cwd);
        await recordVaultIndexed(updatedVault, cwd);
        return json(200, { ok: true, data: { vault: updatedVault, index: data } }, cors.headers);
      }

      if (method === "GET" && action === "index" && segments[4] === "filters") {
        const data = await getMachineIndex(vault, cwd);
        await recordVaultIndexed(vault, cwd);
        return json(
          200,
          buildIndexFilterResponse(data, parseIndexFilterKind(url.searchParams.get("filter"))),
          cors.headers,
        );
      }

      if (method === "GET" && action === "index" && segments[4] === "search") {
        const data = await getMachineIndex(vault, cwd);
        await recordVaultIndexed(vault, cwd);
        return json(200, buildIndexSearchResponse(data, url.searchParams.get("q")), cors.headers);
      }

      if (method === "GET" && action === "index" && segments[4] === "inspect") {
        const data = await getMachineIndex(vault, cwd);
        await recordVaultIndexed(vault, cwd);
        return json(
          200,
          buildVaultInspectResponse(data, url.searchParams.get("path")),
          cors.headers,
        );
      }

      if (method === "GET" && action === "index") {
        const data = await getMachineIndex(vault, cwd);
        await recordVaultIndexed(vault, cwd);
        return json(200, data, cors.headers);
      }
    }

    return json(404, { ok: false, error: "Not found" }, cors.headers);
  } catch (error) {
    return json(
      errorStatus(error),
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
        code: errorCode(error),
      },
      cors.headers,
    );
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
  return JSON.parse(raw);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
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

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status <= 599) return status;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return 404;
  if (code === "EEXIST") return 409;
  if (code === "CONFLICT") return 409;
  if (code === "EACCES" || code === "EPERM") return 403;
  return 400;
}

function errorCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException)?.code;
  return typeof code === "string" ? code : undefined;
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
