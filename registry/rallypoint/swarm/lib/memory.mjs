// The swarm's memory: a zero-dependency client for the user's own Supabase
// project, over PostgREST. Reads use the publishable key; every write goes
// through a secret-checked RPC (see schema.sql). There is no other endpoint —
// nothing here talks to Rallypoint.

export class MemoryError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = "MemoryError";
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {{ url?: string, key?: string, secret?: string, fetchImpl?: typeof fetch }} options
 */
export const createMemory = ({ url, key, secret, fetchImpl = globalThis.fetch } = {}) => {
  const base = url ? String(url).replace(/\/+$/, "") : "";

  const configured = () => Boolean(base && key);
  const canWrite = () => configured() && Boolean(secret);

  const request = async (path, { method = "GET", body, headers = {} } = {}) => {
    if (!configured()) {
      throw new MemoryError("memory is not configured: set RALLYPOINT_SUPABASE_URL and RALLYPOINT_SUPABASE_KEY");
    }
    let response;
    try {
      response = await fetchImpl(`${base}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new MemoryError(`could not reach ${base}: ${error.message}`);
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const message = (data && (data.message || data.hint || data.details)) || text || response.statusText;
      throw new MemoryError(`${method} ${path.split("?")[0]} failed (${response.status}): ${message}`, {
        status: response.status,
        code: data?.code ?? null,
      });
    }
    return data;
  };

  const rpc = (fn, args) => request(`rpc/${fn}`, { method: "POST", body: args });

  const requireSecret = () => {
    if (!secret) throw new MemoryError("writes need RALLYPOINT_SWARM_SECRET (agents only; never commit it)");
    return secret;
  };

  /**
   * @param {string} table
   * @param {{select?: string, order?: string, limit?: number, filters?: Record<string,string>}} query
   */
  // With the secret, read through `swarm_read` (works in private mode, where
  // RLS hides everything from the anon key). Without it, plain PostgREST.
  const select = (table, query = {}) =>
    secret
      ? rpc("swarm_read", {
          p_secret: secret,
          p_table: table,
          p_filters: query.filters ?? {},
          p_order: query.order ?? null,
          p_limit: query.limit ?? null,
        })
      : restSelect(table, query);

  const restSelect = (table, { select: columns = "*", order, limit, filters = {} } = {}) => {
    const params = new URLSearchParams({ select: columns });
    if (order) params.set("order", order);
    if (limit) params.set("limit", String(limit));
    for (const [column, condition] of Object.entries(filters)) params.append(column, condition);
    return request(`${table}?${params}`);
  };

  return {
    configured,
    canWrite,
    select,
    rpc,
    schemaVersion: () => rpc("swarm_schema_version", {}),
    check: () => rpc("swarm_check", { p_secret: requireSecret() }),
    insert: (table, row) => rpc("swarm_write", { p_secret: requireSecret(), p_table: table, p_row: row }),
    update: (table, id, patch) =>
      rpc("swarm_update", { p_secret: requireSecret(), p_table: table, p_id: String(id), p_patch: patch }),
    setSetting: (keyName, value) =>
      rpc("swarm_set_setting", { p_secret: requireSecret(), p_key: keyName, p_value: value }),
  };
};

export const memoryFromEnv = (env = process.env, fetchImpl) =>
  createMemory({
    url: env.RALLYPOINT_SUPABASE_URL,
    key: env.RALLYPOINT_SUPABASE_KEY,
    secret: env.RALLYPOINT_SWARM_SECRET,
    fetchImpl,
  });
