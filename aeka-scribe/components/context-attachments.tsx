'use client';
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { runtime } from '../lib/desktop-runtime';
import { extractDocument, imageForExtraction } from '../lib/document-context';
import type { NoteDetails } from '../lib/note-details';
import { newId } from '../lib/flow-core';
export function ContextAttachments({
  noteId,
  context,
  onChange,
  configured,
}: {
  noteId: string;
  context: NoteDetails['context'];
  onChange: (v: NoteDetails['context']) => void;
  configured: boolean;
}) {
  const file = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<{
      name: string;
      text: string;
      truncated: boolean;
      image?: string;
    } | null>(null);
  useEffect(() => {
    generation.current++;
    setPreview(null);
    setError('');
    setBusy(false);
  }, [noteId]);
  const select = async (f: File) => {
    const g = ++generation.current;
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const image = /\.(png|jpe?g|webp)$/i.test(f.name);
      const result = image
        ? { text: '', truncated: false, image: await imageForExtraction(f) }
        : await extractDocument(f);
      if (g === generation.current) setPreview({ name: f.name.slice(0, 200), ...result });
    } catch (e: any) {
      if (g === generation.current) setError(e.message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  };
  const ocr = async () => {
    if (!preview?.image) return;
    const g = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const r = await runtime('context.image', { image: preview.image });
      if (g === generation.current) setPreview({ ...preview, ...r, image: undefined });
    } catch (e: any) {
      if (g === generation.current) setError(e.message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  };
  const apply = () => {
    if (!preview) return;
    if (
      context.length >= 10 ||
      context.reduce((n, c) => n + c.text.length, 0) + preview.text.length > 100000
    ) {
      setError('This note has reached its context limit: 10 files and 100,000 characters.');
      return;
    }
    onChange([...context, { id: newId(), name: preview.name, text: preview.text, at: Date.now() }]);
    setPreview(null);
  };
  return (
    <details className="studio-details">
      <summary>Attached context · {context.length}/10</summary>
      <p className="small-print">
        PDF, Word (.docx), text and images. Review extracted text before adding it. Only the text is saved and
        included when this note is synced, shared or used with AI. Original files are not stored.
      </p>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      {context.map((c) => (
        <article className="context-file" key={c.id}>
          <strong>{c.name}</strong>
          <small>{c.text.length.toLocaleString()} characters</small>
          <button
            className="icon-button"
            aria-label={'Remove ' + c.name}
            onClick={() => onChange(context.filter((x) => x.id !== c.id))}
          >
            <Trash2 size={14} />
          </button>
          <details>
            <summary>Preview text</summary>
            <pre>{c.text}</pre>
          </details>
        </article>
      ))}
      <input
        ref={file}
        hidden
        type="file"
        accept=".pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void select(f);
        }}
      />
      <button
        className="button secondary"
        disabled={busy || context.length >= 10}
        onClick={() => file.current?.click()}
      >
        {busy ? 'Reading…' : 'Attach context'}
      </button>
      {preview && (
        <div className="studio-review">
          <h4>Review · {preview.name}</h4>
          {preview.image ? (
            <>
              <img
                src={preview.image}
                alt="Image selected for text extraction"
                style={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain' }}
              />
              <p className="small-print">
                Extracting sends this resized image to OpenAI using your configured API connection. API
                charges apply. Check the result for misread numbers and names.
              </p>
              <button className="button primary" disabled={busy || !configured} onClick={() => void ocr()}>
                {busy ? 'Extracting…' : 'Extract text with OpenAI'}
              </button>
              {!configured && <p>Connect OpenAI in settings to extract image text.</p>}
            </>
          ) : (
            <>
              <textarea
                aria-label="Extracted attachment text"
                value={preview.text}
                maxLength={30000}
                onChange={(e) => setPreview({ ...preview, text: e.target.value })}
              />
              {preview.truncated && (
                <p className="notice warning">
                  Only the first 30,000 characters or 100 PDF pages were extracted. Split a longer document to
                  include the rest.
                </p>
              )}
              <button className="button primary" disabled={busy || !preview.text.trim()} onClick={apply}>
                Add reviewed text to note
              </button>
            </>
          )}
          <button className="button ghost" disabled={busy} onClick={() => setPreview(null)}>
            Discard
          </button>
        </div>
      )}
      <p className="small-print">
        Up to 10 MB per document; 30,000 saved characters each, 100,000 total. Password-protected PDFs are
        unsupported. For scanned PDFs, attach page images.
      </p>
    </details>
  );
}
