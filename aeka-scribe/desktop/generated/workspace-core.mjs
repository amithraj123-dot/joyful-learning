import { validDetails, noteDetails } from './note-details.mjs';
export function meetingURL(value) {
    if (typeof value !== 'string')
        return '';
    try {
        const u = new URL(value);
        const h = u.hostname.toLowerCase();
        if (u.protocol !== 'https:' || u.username || u.password || u.port)
            return '';
        const domains = [
            'meet.google.com',
            'zoom.us',
            'zoomgov.com',
            'teams.microsoft.com',
            'teams.live.com',
            'teams.cloud.microsoft',
            'webex.com',
            'whereby.com',
            'chime.aws',
            'app.slack.com',
        ];
        return domains.some((d) => h === d || h.endsWith('.' + d)) ? u.href : '';
    }
    catch {
        return '';
    }
}
export function findMeetingURL(...values) {
    for (const value of values) {
        if (typeof value !== 'string')
            continue;
        for (const candidate of value.match(/https:\/\/[^\s<>"']+/g) || []) {
            const u = meetingURL(candidate.replace(/[),.;]+$/, ''));
            if (u)
                return u;
        }
    }
    return '';
}
export function validNote(value) {
    if (!value || typeof value !== 'object')
        throw Error('Invalid note.');
    if (JSON.stringify(value).length > 1750000)
        throw Error('This note exceeds the storage limit.');
    const n = value;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(n.id) ||
        !['meeting', 'scratchpad'].includes(n.kind) ||
        !['draft', 'recording', 'complete', 'interrupted'].includes(n.status))
        throw Error('Invalid note identity.');
    for (const [key, max] of [
        ['title', 300],
        ['folder', 100],
        ['body', 200000],
        ['summary', 100000],
        ['eventId', 500],
    ])
        if (typeof n[key] !== 'string' || n[key].length > max)
            throw Error('Note field exceeds its limit.');
    if (!Number.isFinite(n.createdAt) ||
        !Number.isFinite(n.updatedAt) ||
        !Number.isFinite(n.duration) ||
        n.duration < 0 ||
        n.duration > 86400)
        throw Error('Invalid note time.');
    if (!Array.isArray(n.segments) ||
        n.segments.length > 10000 ||
        !n.segments.every((s) => s &&
            typeof s.id === 'string' &&
            s.id.length <= 120 &&
            typeof s.text === 'string' &&
            s.text.length <= 20000 &&
            typeof s.speaker === 'string' &&
            s.speaker.length <= 100 &&
            Number.isFinite(s.start) &&
            s.start >= 0 &&
            Number.isFinite(s.end) &&
            s.end >= s.start))
        throw Error('Invalid transcript.');
    if (!n.speakers ||
        typeof n.speakers !== 'object' ||
        Array.isArray(n.speakers) ||
        Object.keys(n.speakers).length > 200 ||
        !Object.values(n.speakers).every((v) => typeof v === 'string' && v.length <= 100))
        throw Error('Invalid speakers.');
    return {
        id: n.id,
        title: n.title,
        kind: n.kind,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        folder: n.folder,
        body: n.body,
        summary: n.summary,
        segments: n.segments.map((s) => ({
            id: s.id,
            text: s.text,
            speaker: s.speaker,
            start: s.start,
            end: s.end,
        })),
        speakers: { ...n.speakers },
        eventId: n.eventId,
        status: n.status,
        duration: n.duration,
        ...(n.details !== undefined ? { details: validDetails(n.details) } : {}),
    };
}
export function upsertSegment(segments, next) {
    return [...segments.filter((s) => s.id !== next.id), next].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
export function transcriptText(note) {
    return note.segments
        .map((s) => `[${Math.floor(s.start / 60)}:${Math.floor(s.start % 60)
        .toString()
        .padStart(2, '0')}] ${note.speakers[s.speaker] || s.speaker || 'Speaker'}: ${s.text}`)
        .join('\n');
}
export function exportNote(note, includeTranscript = true) {
    return `# ${note.title}\n\n${new Date(note.createdAt).toLocaleString()}\n\n## Notes\n\n${note.body}\n\n## Summary\n\n${note.summary}${note.details
        ? '\n\n## Meeting details\n\nAttendees: ' +
            noteDetails(note).attendees.join(', ') +
            '\nTags: ' +
            noteDetails(note).tags.join(', ') +
            '\n\n## Brief\n\n' +
            noteDetails(note).brief +
            '\n\n## Follow-up draft\n\n' +
            noteDetails(note).followUp +
            '\n\n## Action checklist\n\n' +
            noteDetails(note)
                .actions.map((a) => '- [' +
                (a.done ? 'x' : ' ') +
                '] ' +
                a.text +
                ' — ' +
                (a.owner || 'Unassigned') +
                (a.due ? ' · ' + a.due : ''))
                .join('\n')
        : ''}${includeTranscript ? '\n\n## Transcript\n\n' + transcriptText(note) : ''}`;
}
export function citationsFromAnswer(text, ids) {
    const allowed = new Set(ids);
    return [
        ...new Set([...text.matchAll(/\[note:([a-zA-Z0-9_-]+)\]/g)].map((x) => x[1]).filter((id) => allowed.has(id))),
    ];
}
export function encodeWav(samples, sampleRate) {
    const b = new ArrayBuffer(44 + samples.length * 2), v = new DataView(b);
    const str = (at, s) => {
        for (let i = 0; i < s.length; i++)
            v.setUint8(at + i, s.charCodeAt(i));
    };
    str(0, 'RIFF');
    v.setUint32(4, b.byteLength - 8, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true);
    }
    return b;
}
