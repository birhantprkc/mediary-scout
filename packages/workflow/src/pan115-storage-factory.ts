import {
  createProtectedStorage115Executor,
  type Pan115ApiGuard,
  type Pan115ApiGuardOptions,
  type Storage115Executor,
} from "./storage-115-executor.js";
import {
  Pan115CookieClient,
  type Pan115CookieClientOptions,
  type Pan115FetchJson,
} from "./pan115-cookie-client.js";

export interface ProtectedPan115CookieStorageExecutorFromEnvOptions {
  env?: Record<string, string | undefined>;
  fetchJson?: Pan115FetchJson;
  apiGuard?: Pan115ApiGuard;
  apiGuardOptions?: Pan115ApiGuardOptions;
  listLimit?: number;
}

export function createProtectedPan115CookieStorageExecutorFromEnv(
  options: ProtectedPan115CookieStorageExecutorFromEnvOptions = {},
): Storage115Executor {
  const env = options.env ?? process.env;
  const clientOptions: Pan115CookieClientOptions = {
    cookie: env["PAN115_COOKIE"] ?? "",
  };
  if (options.fetchJson !== undefined) {
    clientOptions.fetchJson = options.fetchJson;
  }
  if (options.listLimit !== undefined) {
    clientOptions.listLimit = options.listLimit;
  }
  const api = new Pan115CookieClient(clientOptions);
  const executorOptions: Parameters<typeof createProtectedStorage115Executor>[0] = {
    api,
    env,
  };
  if (options.apiGuard !== undefined) {
    executorOptions.apiGuard = options.apiGuard;
  }
  if (options.apiGuardOptions !== undefined) {
    executorOptions.apiGuardOptions = options.apiGuardOptions;
  }
  return createProtectedStorage115Executor(executorOptions);
}
