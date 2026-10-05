/** The JSON body as an object: bad JSON, null, a list or a scalar all read as empty. */
export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await req.json().catch(() => null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
