import { isTrashed } from './note-details.ts';
import { enforceRetention, getNote, policyFor } from './cloud-store.ts';
import { exportNote, type Note } from './workspace-core.ts';
const tools = [
  {
    name: 'search_notes',
    description:
      'Search your own saved Flow notes and meeting transcripts. Returns at most 20 note titles, IDs and short excerpts. Shared notes, raw audio, credentials and dictation history are excluded.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_note',
    description:
      'Read one of your own Flow notes by its ID, including its summary and timestamped transcript. Use search_notes to find an ID first.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', maxLength: 100 } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];
export async function notesMCP(request: Request, db: D1Database | undefined, userId: string | null) {
  const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' };
  let rpc: any;
  const result = (value: unknown) =>
    Response.json({ jsonrpc: '2.0', id: rpc?.id ?? null, result: value }, { headers });
  try {
    const text = await request.text();
    if (text.length > 10000) throw Error('Request too large.');
    rpc = JSON.parse(text);
    if (rpc?.jsonrpc !== '2.0' || typeof rpc.method !== 'string') throw Error('Invalid JSON-RPC request.');
    if (rpc.method === 'server/discover')
      return result({
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {} },
        serverInfo: { name: 'Flow notes', version: '0.5.0' },
      });
    if (rpc.method === 'tools/list') return result({ tools });
    if (rpc.method !== 'tools/call')
      return Response.json(
        { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: 'Method not found' } },
        { headers },
      );
    if (!userId) throw Error('Sign in to the Flow workspace with your own account.');
    if (!db) throw Error('Workspace storage is unavailable.');
    if (!(await policyFor(db, userId)).cloudAI)
      throw Error('Cloud AI access is disabled in your workspace controls.');
    await enforceRetention(db, userId);
    const name = rpc.params?.name,
      args = rpc.params?.arguments || {};
    let output;
    if (name === 'search_notes') {
      if (
        typeof args.query !== 'string' ||
        args.query.length > 200 ||
        (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20))
      )
        throw Error('Provide a search phrase and a limit between 1 and 20.');
      const q = '%' + args.query.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%',
        rows = await db
          .prepare(
            "SELECT value FROM workspace_notes WHERE owner = ? AND coalesce(json_extract(value,'$.details.trashedAt'),0) = 0 AND lower(value) LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?",
          )
          .bind(userId, q, args.limit || 10)
          .all<{ value: string }>();
      output = rows.results.map((r) => {
        const n = JSON.parse(r.value) as Note;
        return {
          id: n.id,
          title: n.title,
          folder: n.folder,
          updatedAt: n.updatedAt,
          excerpt: (n.summary || n.body || n.segments.map((s) => s.text).join(' ')).slice(0, 1200),
        };
      });
    } else if (name === 'get_note') {
      if (typeof args.id !== 'string' || !/^[\w-]{1,100}$/.test(args.id))
        throw Error('Provide a valid note ID.');
      const note = await getNote(db, userId, args.id);
      if (!note || isTrashed(note)) throw Error('This note does not exist in your account.');
      const text = exportNote(note);
      output = {
        id: note.id,
        title: note.title,
        updatedAt: note.updatedAt,
        markdown: text.slice(0, 150000),
        truncated: text.length > 150000,
      };
    } else throw Error('Unknown tool.');
    return result({ content: [{ type: 'text', text: JSON.stringify(output) }], isError: false });
  } catch (e) {
    if (rpc?.method === 'tools/call')
      return result({
        content: [{ type: 'text', text: e instanceof Error ? e.message : 'The note request failed.' }],
        isError: true,
      });
    return Response.json(
      { jsonrpc: '2.0', id: rpc?.id ?? null, error: { code: -32600, message: 'Invalid request' } },
      { headers, status: 400 },
    );
  }
}
