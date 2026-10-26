// Scribe's read service for other modules. A note is private to its owner; other modules never read
// Scribe's tables. They ask for one of the caller's own notes here and receive only the parts the
// caller chose to share.
import { CloudError, getNote, listNotes } from '../../../lib/cloud-store.ts';
import { isTrashed, noteDetails } from '../../../lib/note-details.ts';
import type { Note } from '../../../lib/workspace-core.ts';

const NOTE_ID = /^[\w-]{1,100}$/;
// A shared transcript is capped so one link stays well inside a database row.
export const MAX_SHARED_TRANSCRIPT = 400000;

// One of the signed-in user's own notes, as saved in their web workspace.
export async function readOwnNote(db: D1Database, userId: string, noteId: unknown): Promise<Note> {
  if (typeof noteId !== 'string' || !NOTE_ID.test(noteId)) throw new CloudError('Choose a note.');
  const note = await getNote(db, userId, noteId);
  if (!note)
    throw new CloudError(
      'This note is not in your web workspace. Save it there (on Windows, sync it) and try again.',
      404,
    );
  if (isTrashed(note)) throw new CloudError('This note is in the trash. Restore it first.');
  if (note.status === 'recording') throw new CloudError('Finish recording before sharing this note.');
  return note;
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

// The parts of a note that can be shared with a team. The transcript is included only when asked for.
export function sharedCopy(note: Note, includeTranscript: boolean) {
  const d = noteDetails(note);
  const start = Date.parse(d.eventStart);
  let transcript = '';
  if (includeTranscript) {
    transcript = [...note.segments]
      .sort((a, b) => a.start - b.start)
      .map((s) => {
        const speaker = (s.speaker && note.speakers[s.speaker]) || s.speaker;
        return `[${clock(s.start)}] ${speaker ? speaker + ': ' : ''}${s.text.trim()}`;
      })
      .join('\n');
    if (transcript.length > MAX_SHARED_TRANSCRIPT)
      transcript = transcript.slice(0, MAX_SHARED_TRANSCRIPT) + '\n[Transcript shortened for sharing]';
  }
  return {
    title: note.title.trim().slice(0, 300) || 'Untitled note',
    meetingAt: Number.isFinite(start) ? start : note.createdAt,
    attendees: d.attendees.slice(0, 250),
    summary: note.summary.slice(0, 100000),
    actions: d.actions.map((a) => ({ id: a.id, text: a.text, owner: a.owner, due: a.due })),
    transcript,
  };
}

// The signed-in user's own live notes matching every word of `query` (title, summary, own notes),
// newest first, as short results for search tools. Transcripts are not searched.
export async function searchOwnNotes(db: D1Database, userId: string, query: string, limit = 8) {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 6);
  if (!words.length) return [];
  const notes = await listNotes(db, userId);
  return notes
    .filter((n) => !isTrashed(n))
    .filter((n) => {
      const hay = `${n.title}\n${n.summary}\n${n.body}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit)
    .map((n) => ({
      id: n.id,
      title: n.title || 'Untitled note',
      kind: n.kind,
      createdAt: n.createdAt,
      snippet: (n.summary || n.body).replace(/\s+/g, ' ').slice(0, 240),
    }));
}
