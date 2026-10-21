'use client';
import { useEffect, useState } from 'react';
import { cloudRuntime, isDesktop, runtime } from '../lib/desktop-runtime';
import { newId, type Term, type Snippet } from '../lib/flow-core';
import { noteFolders, inFolder } from '../lib/note-details';
import type { Note } from '../lib/workspace-core';
type Resources = { terms: Term[]; snippets: Snippet[] };
export function TeamPanel({
  notes,
  resources,
  onImport,
  notify,
}: {
  notes: Note[];
  resources: Resources;
  onImport: (v: Resources) => void;
  notify: (s: string) => void;
}) {
  const [account, setAccount] = useState<any>(null),
    [grants, setGrants] = useState<any[]>([]),
    [shared, setShared] = useState<any[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [draft, setDraft] = useState<Note | null>(null),
    [resourceDraft, setResourceDraft] = useState<any>(null),
    [comments, setComments] = useState<any[]>([]),
    [comment, setComment] = useState(''),
    [recipient, setRecipient] = useState(''),
    [role, setRole] = useState('viewer'),
    [target, setTarget] = useState(''),
    [expires, setExpires] = useState(30),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [signIn, setSignIn] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || 'This action could not finish.');
      setSignIn(e.signInPath || '');
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const [a, g, s, l] = await Promise.all([
      cloudRuntime('status'),
      cloudRuntime('shares.list'),
      cloudRuntime('shared.list'),
      cloudRuntime('audit.list'),
    ]);
    setAccount(a);
    setGrants(g);
    setShared(s);
    setAudit(l);
  };
  useEffect(() => {
    void run(refresh);
  }, []);
  const open = async (item: any) => {
    if ((draft || resourceDraft) && !confirm('Open another item? Unsaved edits will be discarded.')) return;
    setSelected(item);
    setDraft(null);
    setResourceDraft(null);
    setComment('');
    setComments([]);
    if (item.kind === 'resources')
      setResourceDraft(await cloudRuntime('resources.get', { owner: item.owner }));
    else {
      const [note, discussion] = await Promise.all([
        cloudRuntime('shared.get', { owner: item.owner, id: item.target }),
        cloudRuntime('comments.list', { owner: item.owner, id: item.target }),
      ]);
      setDraft(note);
      setComments(discussion);
    }
  };
  return (
    <div className="settings-stack team-workspace">
      {error && (
        <div className="notice warning" role="alert">
          {error}
          {signIn.startsWith('/signin-with-chatgpt?') && (
            <a href={signIn} target="_top">
              Sign in with ChatGPT
            </a>
          )}
        </div>
      )}
      <section className="card form-card">
        <div className="card-heading">
          <div>
            <h2>Share with the right people.</h2>
            <p>
              {account ? 'Signed in as ' + account.email : 'Connect to your web workspace to collaborate.'}
            </p>
          </div>
          <button className="button secondary" disabled={busy} onClick={() => void run(refresh)}>
            Refresh
          </button>
        </div>
        <p>
          Grants apply only to people who can already access this hosted workspace. It is currently
          owner-private. A grant does not send an invitation or change the site’s audience. Use the site’s
          access controls before collaborating with another person.
        </p>
        {isDesktop() && (
          <button
            className="button secondary"
            onClick={() =>
              void run(async () => {
                await runtime('cloud.connect', { enableSync: false });
                notify('Sign in in the new window, close it, then refresh here.');
              })
            }
          >
            Open web sign-in
          </button>
        )}
      </section>
      {account && (
        <>
          <section className="card form-card">
            <h2>Grant access</h2>
            <p>
              Desktop notes must be synced before they can be shared. A viewer can read and comment; an editor
              can also revise the item. Only the owner can grant or revoke access. Folder grants include
              current and future notes in that folder and its subfolders. Moving a note out revokes that
              folder’s access.
            </p>
            <div className="form-grid">
              <label className="field">
                <span>Item</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Choose a note, folder or dictionary</option>
                  <option value="resources">Team vocabulary & snippets</option>
                  {[...new Set(notes.flatMap(noteFolders))].sort().map((f) => (
                    <option key={'folder:' + f} value={'folder:' + f}>
                      Folder: {f} · current and future notes
                    </option>
                  ))}
                  {notes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Recipient’s sign-in email</span>
                <input
                  type="email"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  maxLength={254}
                />
              </label>
              <label className="field">
                <span>Role</span>
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="viewer">Viewer · read and comment</option>
                  <option value="editor">Editor · read, comment and edit</option>
                </select>
              </label>
              <label className="field">
                <span>Access expires</span>
                <select value={expires} onChange={(e) => setExpires(Number(e.target.value))}>
                  <option value={7}>In 7 days</option>
                  <option value={30}>In 30 days</option>
                  <option value={90}>In 90 days</option>
                  <option value={0}>When I revoke it</option>
                </select>
              </label>
            </div>
            <button
              className="button primary"
              disabled={busy || !target || !recipient || !account.policy.sharing}
              onClick={() =>
                void run(async () => {
                  await cloudRuntime('shares.grant', {
                    kind:
                      target === 'resources' ? 'resources' : target.startsWith('folder:') ? 'folder' : 'note',
                    id: target.startsWith('folder:') ? target.slice(7) : target,
                    email: recipient,
                    role,
                    expiresAt: expires ? Date.now() + expires * 86400000 : 0,
                  });
                  setRecipient('');
                  await refresh();
                  notify('Access grant saved. No invitation was sent.');
                })
              }
            >
              Grant access
            </button>
            <div className="grant-list">
              {grants.map((g) => (
                <div className="app-style-row" key={g.kind + g.target + g.email}>
                  <span>
                    <strong>{g.email}</strong>
                    <small>
                      {g.kind === 'resources'
                        ? 'Team dictionary'
                        : g.kind === 'folder'
                          ? 'Folder: ' + g.target
                          : notes.find((n) => n.id === g.target)?.title || g.target}{' '}
                      · {g.role}
                      {g.expires_at ? ' · expires ' + new Date(g.expires_at).toLocaleDateString() : ''}
                    </small>
                  </span>
                  <button
                    className="button ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await cloudRuntime('shares.revoke', { kind: g.kind, id: g.target, email: g.email });
                        await refresh();
                      })
                    }
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="card form-card">
            <h2>Team vocabulary & snippets</h2>
            <p>
              Publish a copy of your {resources.terms.length} terms and {resources.snippets.length} snippets.
              Dictation history, API keys and preferences are excluded. Updates use revision checks, and
              imports preserve your existing phrases and triggers.
            </p>
            <div className="inline-actions wrap">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const old = await cloudRuntime('resources.get');
                    if (
                      old.revision &&
                      !confirm(
                        'Replace the published team dictionary with your current vocabulary and snippets?',
                      )
                    )
                      return;
                    await cloudRuntime('resources.save', { value: resources, revision: old.revision });
                    notify('Team dictionary published to your account. Grant access above to share it.');
                  })
                }
              >
                Publish my vocabulary & snippets
              </button>
              <button
                className="button ghost"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    open({ owner: account.account, kind: 'resources', target: 'dictionary', role: 'owner' }),
                  )
                }
              >
                Review published dictionary
              </button>
            </div>
          </section>
          <div className="notes-layout">
            <aside className="notes-list">
              <h3 className="shared-heading">Shared with me</h3>
              {!shared.length && (
                <p className="empty-inline">No items have been shared with this account yet.</p>
              )}
              {shared.map((item) => (
                <button
                  className={
                    'note-list-item ' +
                    (selected?.owner === item.owner && selected?.target === item.target ? 'selected' : '')
                  }
                  key={item.owner + item.kind + item.target}
                  onClick={() => void run(() => open(item))}
                >
                  <strong>{item.note?.title || 'Team vocabulary & snippets'}</strong>
                  <small>{item.role}</small>
                </button>
              ))}
              <h3 className="shared-heading">My note discussions</h3>
              {notes
                .filter((n) =>
                  grants.some(
                    (g) =>
                      (g.kind === 'note' && g.target === n.id) ||
                      (g.kind === 'folder' && inFolder(n, g.target)),
                  ),
                )
                .map((n) => (
                  <button
                    className="note-list-item"
                    key={n.id}
                    onClick={() =>
                      void run(() =>
                        open({ owner: account.account, kind: 'note', target: n.id, role: 'owner', note: n }),
                      )
                    }
                  >
                    <strong>{n.title}</strong>
                    <small>Owner</small>
                  </button>
                ))}
            </aside>
            <section className="card form-card">
              {!selected ? (
                <>
                  <h2>A shared place for the details.</h2>
                  <p>Choose an item to review it or discuss it with collaborators.</p>
                </>
              ) : (
                <>
                  <p className="eyebrow">{selected.role} ACCESS</p>
                  {draft && (
                    <>
                      <label className="field">
                        <span>Title</span>
                        <input
                          value={draft.title}
                          disabled={selected.role === 'viewer'}
                          maxLength={300}
                          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Notes</span>
                        <textarea
                          rows={7}
                          value={draft.body}
                          disabled={selected.role === 'viewer'}
                          maxLength={200000}
                          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Summary</span>
                        <textarea
                          rows={5}
                          value={draft.summary}
                          disabled={selected.role === 'viewer'}
                          maxLength={100000}
                          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                        />
                      </label>
                      <details>
                        <summary>Transcript · {draft.segments.length} segments</summary>
                        {draft.segments.map((s) => (
                          <p key={s.id}>
                            <small>
                              {Math.floor(s.start / 60)}:
                              {Math.floor(s.start % 60)
                                .toString()
                                .padStart(2, '0')}{' '}
                              {draft.speakers[s.speaker] || s.speaker}
                            </small>
                            <br />
                            {s.text}
                          </p>
                        ))}
                      </details>
                      {selected.role !== 'viewer' && (
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const saved = await cloudRuntime('shared.save', {
                                owner: selected.owner,
                                note: draft,
                                baseUpdatedAt: draft.updatedAt,
                              });
                              setDraft(saved);
                              notify('Shared note saved');
                            })
                          }
                        >
                          Save shared edits
                        </button>
                      )}
                      <h3>Discussion</h3>
                      {comments.map((c) => (
                        <article className="comment" key={c.id}>
                          <small>
                            {c.email} · {new Date(c.at).toLocaleString()}
                          </small>
                          <p>{c.text}</p>
                          {(c.author === account.account || selected.owner === account.account) && (
                            <button
                              className="button ghost"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await cloudRuntime('comments.delete', {
                                    owner: selected.owner,
                                    id: selected.target,
                                    commentId: c.id,
                                  });
                                  setComments(
                                    await cloudRuntime('comments.list', {
                                      owner: selected.owner,
                                      id: selected.target,
                                    }),
                                  );
                                })
                              }
                            >
                              Delete comment
                            </button>
                          )}
                        </article>
                      ))}
                      <label className="field">
                        <span>Add a comment</span>
                        <textarea
                          value={comment}
                          rows={3}
                          maxLength={4000}
                          onChange={(e) => setComment(e.target.value)}
                        />
                      </label>
                      <button
                        className="button secondary"
                        disabled={busy || !comment.trim()}
                        onClick={() =>
                          void run(async () => {
                            await cloudRuntime('comments.add', {
                              owner: selected.owner,
                              id: selected.target,
                              commentId: newId(),
                              text: comment,
                            });
                            setComment('');
                            setComments(
                              await cloudRuntime('comments.list', {
                                owner: selected.owner,
                                id: selected.target,
                              }),
                            );
                          })
                        }
                      >
                        Post comment
                      </button>
                    </>
                  )}
                  {resourceDraft && (
                    <>
                      <h2>Vocabulary & snippets</h2>
                      <div className="resource-editor">
                        {resourceDraft.value.terms.map((t: Term, i: number) => (
                          <div className="form-grid" key={t.id}>
                            <label className="field">
                              <span>Spoken phrase</span>
                              <input
                                value={t.phrase}
                                maxLength={80}
                                disabled={selected.role === 'viewer'}
                                onChange={(e) =>
                                  setResourceDraft({
                                    ...resourceDraft,
                                    value: {
                                      ...resourceDraft.value,
                                      terms: resourceDraft.value.terms.map((v: Term, j: number) =>
                                        i === j ? { ...v, phrase: e.target.value } : v,
                                      ),
                                    },
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>Preferred spelling</span>
                              <input
                                value={t.replacement}
                                maxLength={80}
                                disabled={selected.role === 'viewer'}
                                onChange={(e) =>
                                  setResourceDraft({
                                    ...resourceDraft,
                                    value: {
                                      ...resourceDraft.value,
                                      terms: resourceDraft.value.terms.map((v: Term, j: number) =>
                                        i === j ? { ...v, replacement: e.target.value } : v,
                                      ),
                                    },
                                  })
                                }
                              />
                            </label>
                          </div>
                        ))}
                        {resourceDraft.value.snippets.map((t: Snippet, i: number) => (
                          <label className="field" key={t.id}>
                            <span>“{t.trigger}”</span>
                            <textarea
                              value={t.text}
                              maxLength={5000}
                              disabled={selected.role === 'viewer'}
                              onChange={(e) =>
                                setResourceDraft({
                                  ...resourceDraft,
                                  value: {
                                    ...resourceDraft.value,
                                    snippets: resourceDraft.value.snippets.map((v: Snippet, j: number) =>
                                      i === j ? { ...v, text: e.target.value } : v,
                                    ),
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <div className="inline-actions wrap">
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => {
                            onImport(resourceDraft.value);
                            notify(
                              'Imported new terms and snippets. Your existing phrases and triggers were kept.',
                            );
                          }}
                        >
                          Import into my dictation profile
                        </button>
                        {selected.role !== 'viewer' && (
                          <button
                            className="button primary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                setResourceDraft(
                                  await cloudRuntime('resources.save', {
                                    owner: selected.owner,
                                    value: resourceDraft.value,
                                    revision: resourceDraft.revision,
                                  }),
                                );
                                notify('Team dictionary updated');
                              })
                            }
                          >
                            Save dictionary edits
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </section>
          </div>
          <section className="card form-card">
            <h2>Use your notes in ChatGPT</h2>
            <p>
              The private Flow workspace exposes read-only note search and retrieval through its own MCP
              connection. Install or connect the Flow workspace plugin under ChatGPT Plugins → Personal →
              Created by you. It uses your existing sign-in and reads only your own saved notes. Turn off
              cloud AI below to block this access.
            </p>
            <p className="small-print">
              Shared notes, raw audio, API keys and dictation history are excluded. This connection does not
              create or edit notes.
            </p>
          </section>
          <section className="card form-card">
            <h2>Workspace controls</h2>
            <p>
              These controls govern your hosted notes. Windows administrators can also apply a managed device
              policy in Desktop settings.
            </p>
            <label className="toggle-row">
              <strong>Allow collaboration grants</strong>
              <input
                type="checkbox"
                checked={account.policy.sharing}
                onChange={(e) =>
                  setAccount({ ...account, policy: { ...account.policy, sharing: e.target.checked } })
                }
              />
            </label>
            <label className="toggle-row">
              <strong>Allow cloud AI on hosted notes</strong>
              <input
                type="checkbox"
                checked={account.policy.cloudAI}
                onChange={(e) =>
                  setAccount({ ...account, policy: { ...account.policy, cloudAI: e.target.checked } })
                }
              />
            </label>
            <label className="field">
              <span>Delete notes after this period without updates</span>
              <select
                value={account.policy.retentionDays}
                onChange={(e) =>
                  setAccount({
                    ...account,
                    policy: { ...account.policy, retentionDays: Number(e.target.value) },
                  })
                }
              >
                {[0, 7, 30, 90, 365].map((n) => (
                  <option value={n} key={n}>
                    {n ? n + ' days' : 'Keep until I delete them'}
                  </option>
                ))}
              </select>
            </label>
            <p className="small-print">
              Retention runs on workspace access, up to 100 expired notes per request. Active recordings are
              excluded. Deletions propagate through sync; independent backups are retained separately.
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                if (
                  account.policy.retentionDays &&
                  !confirm(
                    'Apply this retention period? Older inactive notes will be permanently deleted and removed from synced devices.',
                  )
                )
                  return;
                void run(async () => {
                  await cloudRuntime('policy.save', { policy: account.policy });
                  await refresh();
                  notify('Workspace controls saved');
                });
              }}
            >
              Save workspace controls
            </button>
            <details className="audit-details">
              <summary>Recent audit activity · metadata only</summary>
              <div className="audit-table">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>Action</th>
                      <th>Item</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((a, i) => (
                      <tr key={i}>
                        <td>{new Date(a.at).toLocaleString()}</td>
                        <td>{a.actor === account.account ? 'You' : a.actor}</td>
                        <td>{a.action}</td>
                        <td>{a.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <small>
                Latest 200 events shown. Up to 1,000 retained per owner. This is an application audit trail,
                not a tamper-proof compliance archive.
              </small>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
