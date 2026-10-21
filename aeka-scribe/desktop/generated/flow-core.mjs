export const defaults = {
    engine: 'browser',
    language: 'en-IN',
    style: 'clean',
    retention: 30,
    deviceId: '',
    useVocabulary: true,
    expandSnippets: false,
    context: '',
};
export const seedTerms = [
    { id: 'aeka', phrase: 'aeka advisors', replacement: 'Aeka Advisors' },
    { id: 'gst', phrase: 'GST', replacement: 'GST' },
    { id: 'tds', phrase: 'TDS', replacement: 'TDS' },
    { id: 'indas', phrase: 'Ind AS', replacement: 'Ind AS' },
];
export const seedSnippets = [
    { id: 'signoff', trigger: 'insert my sign off', text: 'Kind regards,\nAmith' },
    {
        id: 'review',
        trigger: 'insert review request',
        text: 'Please review the attached document and share your comments.',
    },
];
const escapeRE = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const boundary = (s) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escapeRE(s)}(?![\\p{L}\\p{M}\\p{N}_])`, 'giu');
// One pass over the original text: replacement text can never trigger another rule.
export function replacePhrases(text, rules) {
    const sorted = rules.filter((r) => r.from.trim()).sort((a, b) => b.from.length - a.from.length);
    if (!sorted.length)
        return { text, count: 0 };
    const lookup = new Map(sorted.map((r) => [r.from.toLocaleLowerCase(), r.to]));
    const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${sorted.map((r) => escapeRE(r.from)).join('|')})(?![\\p{L}\\p{M}\\p{N}_])`, 'giu');
    let count = 0;
    return {
        text: text.replace(pattern, (match) => {
            count++;
            return lookup.get(match.toLocaleLowerCase()) ?? match;
        }),
        count,
    };
}
export function formatText(raw, settings, terms, snippets) {
    if (settings.style === 'verbatim')
        return { text: raw, changes: [] };
    let text = raw.trim();
    const changes = [];
    if (settings.useVocabulary) {
        const r = replacePhrases(text, terms.map((t) => ({ from: t.phrase, to: t.replacement })));
        text = r.text;
        if (r.count)
            changes.push(`${r.count} vocabulary match${r.count === 1 ? '' : 'es'}`);
    }
    if (settings.expandSnippets) {
        const r = replacePhrases(text, snippets.map((t) => ({ from: t.trigger, to: t.text })));
        text = r.text;
        if (r.count)
            changes.push(`${r.count} snippet${r.count === 1 ? '' : 's'} expanded`);
    }
    // Only isolated hesitation sounds; never delete repeated words, negation, or numbers.
    const clean = text
        .replace(boundary('um'), '')
        .replace(boundary('uh'), '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([,.;!?])/g, '$1')
        .replace(/(^|\n)[ \t]+/g, '$1')
        .trim();
    if (clean !== text)
        changes.push('Hesitations and spacing cleaned');
    text = clean;
    if (settings.style === 'sentences' || settings.style === 'notes') {
        text = text.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, a, b) => a + b.toLocaleUpperCase());
        if (text && !/[.!?:;]$/.test(text))
            text += '.';
        if (settings.style === 'notes')
            text = text
                .split(/\n+|(?<=[.!?])\s+(?=\p{Lu})/u)
                .filter(Boolean)
                .map((line) => `• ${line.replace(/^[-•]\s*/, '')}`)
                .join('\n');
        changes.push(settings.style === 'notes' ? 'Bullet layout applied' : 'Sentence casing applied');
    }
    return { text, changes };
}
export function pruneHistory(entries, days, now = Date.now()) {
    if (days === 0)
        return [];
    return entries
        .filter((e) => Number.isFinite(e.createdAt) && (days === -1 || e.createdAt >= now - days * 86400000))
        .slice(0, 200);
}
export function wordCount(text) {
    return text.trim() ? text.trim().split(/\s+/u).length : 0;
}
export function importantTokens(text) {
    return (text
        .match(/[+-]?\d[\d,.]*(?:%|(?=\b))|\b(?:not|never|no|without|cannot|can['’]t|don['’]t|won['’]t|isn['’]t|aren['’]t|shouldn['’]t|mustn['’]t)\b/gi)
        ?.map((t) => t.toLowerCase()) ?? []);
}
export function reviewChanges(raw, result) {
    return JSON.stringify(importantTokens(raw)) !== JSON.stringify(importantTokens(result));
}
export function sanitizeKeywords(value) {
    if (!Array.isArray(value))
        return [];
    return [
        ...new Set(value
            .filter((s) => typeof s === 'string')
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && s.length <= 80 && !/[<>\r\n]/.test(s))),
    ].slice(0, 100);
}
export function validateBackup(value) {
    if (!value || typeof value !== 'object')
        return null;
    const v = value;
    if (v.version !== 2 ||
        !Array.isArray(v.terms) ||
        !Array.isArray(v.snippets) ||
        !Array.isArray(v.history) ||
        !v.settings ||
        typeof v.settings !== 'object')
        return null;
    const string = (x, max) => typeof x === 'string' && x.length <= max;
    if (v.terms.length > 500 || v.snippets.length > 200 || v.history.length > 200)
        return null;
    if (!v.terms.every((x) => x && string(x.id, 100) && string(x.phrase, 80) && string(x.replacement, 80)))
        return null;
    if (!v.snippets.every((x) => x && string(x.id, 100) && string(x.trigger, 80) && string(x.text, 5000)))
        return null;
    if (!v.history.every((x) => x &&
        string(x.id, 100) &&
        Number.isFinite(x.createdAt) &&
        string(x.raw, 100000) &&
        string(x.text, 100000) &&
        string(x.engine, 50) &&
        Number.isFinite(x.duration) &&
        ['verbatim', 'clean', 'sentences', 'notes'].includes(x.style)))
        return null;
    const s = v.settings;
    if (!['browser', 'openai'].includes(s.engine) ||
        !['en-IN', 'en-US', 'en-GB', 'hi-IN', 'kn-IN', 'ta-IN', 'te-IN', 'mr-IN'].includes(s.language) ||
        !['verbatim', 'clean', 'sentences', 'notes'].includes(s.style) ||
        ![0, 1, 7, 30, -1].includes(s.retention) ||
        !string(s.deviceId, 300) ||
        !string(s.context, 1000) ||
        typeof s.useVocabulary !== 'boolean' ||
        typeof s.expandSnippets !== 'boolean')
        return null;
    return { terms: v.terms, snippets: v.snippets, history: pruneHistory(v.history, s.retention), settings: s };
}
export function newId() {
    return typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}
