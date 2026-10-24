// Calls a module action on the hosted workspace (POST /api/modules).
export class ModuleError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function callModule<T = unknown>(
  module: string,
  action: string,
  payload: object = {},
): Promise<T> {
  let r: Response;
  try {
    r = await fetch('/api/modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, module, action }),
    });
  } catch {
    throw new ModuleError('Could not reach the workspace. Check your connection and try again.', 0);
  }
  const body = (await r.json().catch(() => ({}))) as { value?: T; error?: string };
  if (!r.ok) throw new ModuleError(body.error || 'The workspace request failed.', r.status);
  return body.value as T;
}
