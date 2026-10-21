import crypto from 'node:crypto';
import { isTrashed } from '../generated/note-details.mjs';
const tokenProviders = ['slack', 'notion', 'hubspot', 'attio', 'affinity', 'zapier'];
const actionProviders = [...tokenProviders, 'gmail', 'outlook', 'google-event', 'outlook-event'];
const text = (v, max, label) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0'))
    throw Error('Invalid ' + label + '.');
  return v.trim();
};
const uuid = (v) =>
  typeof v === 'string' && /^(?:[a-f\d]{32}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})$/i.test(v);
const numeric = (v) => typeof v === 'string' && /^[1-9]\d{0,14}$/.test(v);
const escapeHTML = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const digest = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function emailAddresses(value, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > 6000 || /[\r\n]/.test(value))
    throw Error('Enter comma-separated email addresses without display names.');
  const result = [
    ...new Set(
      value
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (
    (!allowEmpty && !result.length) ||
    result.length > 20 ||
    result.some(
      (x) =>
        x.length > 254 ||
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(x),
    )
  )
    throw Error('Enter up to 20 valid email addresses.');
  return result;
}
export function zapierURL(value) {
  const raw = text(value, 500, 'Zapier Catch Hook URL');
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw Error('Enter a Zapier Catch Hook URL.');
  }
  if (
    u.protocol !== 'https:' ||
    u.hostname !== 'hooks.zapier.com' ||
    u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !/^\/hooks\/catch\/\d+\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)
  )
    throw Error('Use an HTTPS hooks.zapier.com/hooks/catch URL.');
  return u.href;
}
export function validateAction(p) {
  if (!p || !actionProviders.includes(p.provider)) throw Error('Choose a supported destination.');
  const n = {
    provider: p.provider,
    noteId: text(p.noteId, 100, 'note'),
    title: text(p.title, 200, 'title'),
    body: text(p.body, 30000, 'message'),
    target: typeof p.target === 'string' ? p.target.trim() : '',
    kind: typeof p.kind === 'string' ? p.kind : '',
  };
  if (!/^[\w-]{1,100}$/.test(n.noteId) || /[\r\n]/.test(n.title)) throw Error('Invalid note or title.');
  if (['gmail', 'outlook', 'google-event', 'outlook-event'].includes(n.provider))
    n.recipients = emailAddresses(n.target, n.provider.endsWith('-event'));
  if (n.provider === 'slack' && !/^[CG][A-Z0-9]{8,20}$/.test(n.target))
    throw Error('Enter a Slack channel ID, not a channel name or URL.');
  if (n.provider === 'slack' && n.body.length > 12000)
    throw Error('Keep Slack messages under 12,000 characters.');
  if (n.provider === 'notion' && !uuid(n.target)) throw Error('Enter the parent Notion page ID.');
  if (
    n.provider === 'hubspot' &&
    (!numeric(n.target) || !['contacts', 'companies', 'deals'].includes(n.kind))
  )
    throw Error('Choose a HubSpot record type and numeric record ID.');
  if (n.provider === 'attio' && (!uuid(n.target) || !['people', 'companies', 'deals'].includes(n.kind)))
    throw Error('Choose an Attio record type and UUID.');
  if (
    n.provider === 'affinity' &&
    (!numeric(n.target) || !['persons', 'organizations', 'opportunities'].includes(n.kind))
  )
    throw Error('Choose an Affinity record type and numeric record ID.');
  if (n.provider === 'zapier') n.target = 'Configured Catch Hook';
  if (n.provider.endsWith('-event')) {
    const start = Date.parse(p.start),
      end = Date.parse(p.end);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end - start > 86400000 ||
      start < Date.now() - 60000
    )
      throw Error('Choose a future start and end, at most 24 hours apart.');
    n.start = new Date(start).toISOString();
    n.end = new Date(end).toISOString();
  }
  return n;
}
export function mailMIME(action, from, id) {
  emailAddresses(from);
  const subject = Buffer.from(action.title).toString('base64'),
    body =
      Buffer.from(action.body.replace(/\r?\n/g, '\r\n'))
        .toString('base64')
        .match(/.{1,76}/g)
        ?.join('\r\n') || '';
  return `From: ${from}\r\nTo: ${action.recipients.join(', ')}\r\nSubject: =?UTF-8?B?${subject}?=\r\nMessage-ID: <${id}@aeka-scribe.local>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`;
}
async function responseJSON(r) {
  const reader = r.body?.getReader();
  if (!reader) return {};
  let size = 0,
    parts = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2 * 1024 * 1024) {
      await reader.cancel();
      throw Error('Provider response was too large.');
    }
    parts.push(Buffer.from(value));
  }
  const s = Buffer.concat(parts).toString();
  return s ? JSON.parse(s) : {};
}
export function createIntegrations({
  vault,
  workspace,
  calendars,
  fetcher = fetch,
  permitted = () => true,
  now = Date.now,
}) {
  let lock = Promise.resolve();
  const serial = (fn) => {
    const p = lock.then(fn);
    lock = p.catch(() => {});
    return p;
  };
  const check = () => {
    if (!permitted()) throw Error('External integrations are disabled by managed policy.');
  };
  const config = () => vault.read('integrations', {});
  const status = async () => {
    const all = await config();
    return tokenProviders.map((provider) => ({
      provider,
      configured: !!all[provider]?.secret,
      label: all[provider]?.label || '',
      verifiedAt: all[provider]?.verifiedAt || 0,
    }));
  };
  const configure = async (p) =>
    serial(async () => {
      check();
      if (!tokenProviders.includes(p?.provider)) throw Error('Unknown connection.');
      const all = await config();
      if (p.disconnect === true) delete all[p.provider];
      else {
        const secret = p.provider === 'zapier' ? zapierURL(p.secret) : text(p.secret, 4000, 'API token');
        if (/[\r\n\s]/.test(secret)) throw Error('Token cannot contain whitespace.');
        all[p.provider] = {
          secret,
          revision: crypto.randomUUID(),
          label: text(p.label, 100, 'account or workflow label'),
          verifiedAt: 0,
        };
      }
      await vault.write('integrations', all);
      return status();
    });
  const auth = async (provider) => {
    check();
    if (['gmail', 'outlook', 'google-event', 'outlook-event'].includes(provider)) {
      const p = provider === 'gmail' || provider === 'google-event' ? 'google' : 'microsoft',
        c = await calendars.access(p, provider.endsWith('-event') ? 'calendarWrite' : 'mailSend');
      return { header: 'Bearer ' + c.token, identity: c.email, key: c.connectionId };
    }
    const c = (await config())[provider];
    if (!c?.secret) throw Error('Configure this connection in Desktop settings first.');
    return {
      header:
        provider === 'affinity'
          ? 'Basic ' + Buffer.from(':' + c.secret).toString('base64')
          : 'Bearer ' + c.secret,
      identity: c.label,
      key: c.revision,
      webhook: provider === 'zapier' ? c.secret : undefined,
    };
  };
  const request = async (
    url,
    credential,
    { method = 'GET', body, notion = false, slack = false, write = false, plain = false } = {},
  ) => {
    let r;
    try {
      r = await fetcher(url, {
        method,
        headers: {
          ...(credential ? { Authorization: credential.header } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(notion ? { 'Notion-Version': '2026-03-11' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw Object.assign(
        Error(
          write
            ? 'Delivery is uncertain. Check the destination before trying again.'
            : 'Could not reach the provider. Try a fresh preview.',
        ),
        { uncertain: write },
      );
    }
    if (!r.ok) {
      const retry = Number(r.headers.get('retry-after'));
      throw Object.assign(
        Error(
          (r.status === 429
            ? 'Provider rate limit reached' +
              (Number.isFinite(retry) && retry > 0 ? '; wait ' + Math.min(retry, 86400) + ' seconds' : '')
            : r.status === 401 || r.status === 403
              ? 'Provider denied access. Check the account, token scopes and target permissions.'
              : 'Provider rejected the request (HTTP ' + r.status + ').') +
            (write && (r.status >= 500 || r.status === 408)
              ? ' Delivery may have occurred. Check the destination.'
              : ''),
        ),
        { uncertain: write && (r.status >= 500 || r.status === 408) },
      );
    }
    if (plain) {
      await r.body?.cancel();
      return {};
    }
    let d;
    try {
      d = await responseJSON(r);
    } catch {
      throw Object.assign(
        Error(
          write
            ? 'The provider response was unreadable. Check the destination before trying again.'
            : 'The provider response was unreadable.',
        ),
        { uncertain: write },
      );
    }
    if (slack && d.ok !== true)
      throw Error('Slack rejected the request. Check channel membership and token permissions.');
    return d;
  };
  const resolve = async (n, a) => {
    if (n.provider === 'slack') {
      const d = await request('https://slack.com/api/conversations.info?channel=' + n.target, a, {
        slack: true,
      });
      if (!d.channel?.id || d.channel.is_archived) throw Error('Choose an active Slack channel.');
      return '#' + d.channel.name + ' · ' + d.channel.id;
    }
    if (n.provider === 'notion') {
      const d = await request('https://api.notion.com/v1/pages/' + n.target, a, { notion: true });
      if (d.in_trash || d.archived) throw Error('This Notion page is in the trash.');
      const title = Object.values(d.properties || {})
        .find((x) => x.type === 'title')
        ?.title?.map((x) => x.plain_text || x.text?.content || '')
        .join('');
      if (!d.id) throw Error('Notion page not found.');
      return (title || 'Untitled page') + ' · ' + d.id;
    }
    if (n.provider === 'hubspot') {
      const properties =
        n.kind === 'contacts'
          ? 'firstname,lastname,email'
          : n.kind === 'companies'
            ? 'name,domain'
            : 'dealname';
      const d = await request(
        'https://api.hubapi.com/crm/v3/objects/' + n.kind + '/' + n.target + '?properties=' + properties,
        a,
      );
      if (!d.id || d.archived) throw Error('CRM record unavailable.');
      const v = d.properties || {};
      return (
        [v.firstname, v.lastname, v.name, v.dealname, v.email, v.domain].filter(Boolean).join(' ') +
        ' · ' +
        d.id
      );
    }
    if (n.provider === 'attio') {
      const d = await request('https://api.attio.com/v2/objects/' + n.kind + '/records/' + n.target, a);
      if (!d.data?.id?.record_id) throw Error('CRM record unavailable.');
      const v = d.data.values || {},
        label =
          v.name?.map((x) => x.full_name || x.value || '').join(' ') ||
          v.email_addresses?.[0]?.email_address ||
          n.kind;
      return label + ' · ' + d.data.id.record_id;
    }
    if (n.provider === 'affinity') {
      const d = await request('https://api.affinity.co/' + n.kind + '/' + n.target, a);
      if (!d.id) throw Error('CRM record unavailable.');
      return (
        [d.first_name, d.last_name, d.name, d.primary_email, d.domain].filter(Boolean).join(' ') +
        ' · ' +
        d.id
      );
    }
    return n.provider === 'zapier'
      ? a.identity + ' · hooks.zapier.com'
      : n.recipients.join(', ') || 'Your calendar only · no attendees';
  };
  const publicDraft = (d) => ({
    id: d.id,
    provider: d.provider,
    noteId: d.noteId,
    title: d.title,
    body: d.body,
    targetLabel: d.targetLabel,
    account: d.account,
    recipients: d.recipients || [],
    start: d.start,
    end: d.end,
    state: d.state,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt,
    conflicts: d.conflicts || [],
    result: d.result || '',
    error: d.error || '',
  });
  const list = async () => {
    await lock;
    return (await vault.read('outbox', [])).slice(0, 100).map(publicDraft);
  };
  const prepare = (p) =>
    serial(async () => {
      check();
      const n = validateAction(p),
        note = (await workspace.list()).find((x) => x.id === n.noteId);
      if (!note || isTrashed(note)) throw Error('Save or restore the note before sharing.');
      const a = await auth(n.provider),
        targetLabel = (await resolve(n, a)).slice(0, 500),
        fingerprint = digest({ ...n, account: a.key });
      const all = await vault.read('outbox', []);
      const prior = all.find(
        (x) =>
          x.fingerprint === fingerprint && ['accepted', 'sent', 'sending', 'uncertain'].includes(x.state),
      );
      if (prior)
        throw Error(
          'This exact action is already ' +
            prior.state +
            '. Check delivery history and the destination before creating a different action.',
        );
      if (tokenProviders.includes(n.provider) && n.provider !== 'zapier') {
        const configs = await config();
        if (configs[n.provider]?.revision === a.key) {
          configs[n.provider].verifiedAt = now();
          await vault.write('integrations', configs);
        }
      }
      let conflicts = [];
      if (n.provider.endsWith('-event')) {
        let u;
        if (n.provider === 'google-event')
          u =
            'https://www.googleapis.com/calendar/v3/calendars/primary/events?' +
            new URLSearchParams({ timeMin: n.start, timeMax: n.end, singleEvents: 'true', maxResults: '50' });
        else
          u =
            'https://graph.microsoft.com/v1.0/me/calendarView?' +
            new URLSearchParams({
              startDateTime: n.start,
              endDateTime: n.end,
              $top: '50',
              $select: 'id,subject,showAs,isCancelled',
            });
        const data = await request(u, a);
        conflicts = (data.items || data.value || [])
          .filter(
            (e) =>
              e.status !== 'cancelled' &&
              !e.isCancelled &&
              e.transparency !== 'transparent' &&
              e.showAs !== 'free',
          )
          .map((e) => (e.summary || e.subject || 'Busy event').slice(0, 200));
        if (data.nextPageToken || data['@odata.nextLink'])
          conflicts.push('More conflicts exist; inspect your calendar.');
      }
      const d = {
        ...n,
        conflicts,
        id: crypto.randomUUID(),
        fingerprint,
        accountKey: a.key,
        account: a.identity,
        targetLabel,
        noteRevision: note.updatedAt,
        state: 'review',
        createdAt: now(),
        expiresAt: now() + 15 * 60000,
      };
      await vault.write(
        'outbox',
        [d, ...all.filter((x) => x.state !== 'review' || x.expiresAt > now())].slice(0, 100),
      );
      return publicDraft(d);
    });
  const send = async (d, a) => {
    if (d.provider === 'gmail') {
      const r = await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', a, {
        method: 'POST',
        body: { raw: Buffer.from(mailMIME(d, a.identity, d.id)).toString('base64url') },
        write: true,
      });
      if (!r.id)
        throw Object.assign(Error('Gmail returned no message ID. Check Sent mail.'), { uncertain: true });
      return { state: 'accepted', result: 'Gmail accepted the message · ' + r.id };
    }
    if (d.provider === 'outlook') {
      await request('https://graph.microsoft.com/v1.0/me/sendMail', a, {
        method: 'POST',
        body: {
          message: {
            subject: d.title,
            body: { contentType: 'Text', content: d.body },
            toRecipients: d.recipients.map((address) => ({ emailAddress: { address } })),
          },
          saveToSentItems: true,
        },
        write: true,
        plain: true,
      });
      return {
        state: 'accepted',
        result: 'Outlook accepted the message. Check Sent Items; acceptance does not confirm delivery.',
      };
    }
    if (d.provider === 'slack') {
      const r = await request('https://slack.com/api/chat.postMessage', a, {
        method: 'POST',
        slack: true,
        write: true,
        body: {
          channel: d.target,
          text: d.title + '\n\n' + d.body,
          client_msg_id: d.id,
          mrkdwn: false,
          parse: 'none',
          link_names: false,
          unfurl_links: false,
          unfurl_media: false,
        },
      });
      if (!r.ts)
        throw Object.assign(Error('Slack returned no receipt. Check the channel.'), { uncertain: true });
      return { state: 'sent', result: 'Slack message ' + r.ts };
    }
    if (d.provider === 'notion') {
      const chunks = [];
      for (let i = 0; i < d.body.length; i += 1800) chunks.push(d.body.slice(i, i + 1800));
      const r = await request('https://api.notion.com/v1/pages', a, {
        method: 'POST',
        notion: true,
        write: true,
        body: {
          parent: { page_id: d.target },
          properties: { title: { title: [{ type: 'text', text: { content: d.title } }] } },
          children: chunks.map((content) => ({
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content } }] },
          })),
        },
      });
      if (!r.id)
        throw Object.assign(Error('Notion returned no page ID. Check the parent page.'), { uncertain: true });
      return { state: 'sent', result: 'Notion page ' + r.id };
    }
    if (d.provider === 'hubspot') {
      const types = { contacts: 202, companies: 190, deals: 214 },
        r = await request('https://api.hubapi.com/crm/v3/objects/notes', a, {
          method: 'POST',
          write: true,
          body: {
            properties: {
              hs_timestamp: new Date(now()).toISOString(),
              hs_note_body:
                '<p>' + escapeHTML(d.title) + '</p><p>' + escapeHTML(d.body).replace(/\n/g, '<br>') + '</p>',
            },
            associations: [
              {
                to: { id: d.target },
                types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: types[d.kind] }],
              },
            ],
          },
        });
      if (!r.id)
        throw Object.assign(Error('HubSpot returned no note ID. Check the record.'), { uncertain: true });
      return { state: 'sent', result: 'HubSpot note ' + r.id };
    }
    if (d.provider === 'attio') {
      const r = await request('https://api.attio.com/v2/notes', a, {
        method: 'POST',
        write: true,
        body: {
          data: {
            parent_object: d.kind,
            parent_record_id: d.target,
            title: d.title,
            format: 'plaintext',
            content: d.body,
          },
        },
      });
      if (!r.data?.id?.note_id)
        throw Object.assign(Error('Attio returned no note ID. Check the record.'), { uncertain: true });
      return { state: 'sent', result: 'Attio note ' + r.data.id.note_id };
    }
    if (d.provider === 'affinity') {
      const fields = {
          persons: 'person_ids',
          organizations: 'organization_ids',
          opportunities: 'opportunity_ids',
        },
        r = await request('https://api.affinity.co/notes', a, {
          method: 'POST',
          write: true,
          body: { [fields[d.kind]]: [Number(d.target)], type: 0, content: d.title + '\n\n' + d.body },
        });
      if (!r.id)
        throw Object.assign(Error('Affinity returned no note ID. Check the record.'), { uncertain: true });
      return { state: 'sent', result: 'Affinity note ' + r.id };
    }
    if (d.provider === 'google-event') {
      const r = await request(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
        a,
        {
          method: 'POST',
          write: true,
          body: {
            summary: d.title,
            description: d.body,
            start: { dateTime: d.start },
            end: { dateTime: d.end },
            attendees: d.recipients.map((email) => ({ email })),
          },
        },
      );
      if (!r.id)
        throw Object.assign(Error('Calendar returned no event ID. Check your calendar.'), {
          uncertain: true,
        });
      return {
        state: 'accepted',
        result:
          'Google Calendar created event ' +
          r.id +
          (d.recipients.length ? ' and requested attendee notifications.' : '.'),
      };
    }
    if (d.provider === 'outlook-event') {
      const r = await request('https://graph.microsoft.com/v1.0/me/events', a, {
        method: 'POST',
        write: true,
        body: {
          subject: d.title,
          body: { contentType: 'Text', content: d.body },
          start: { dateTime: d.start, timeZone: 'UTC' },
          end: { dateTime: d.end, timeZone: 'UTC' },
          attendees: d.recipients.map((address) => ({ emailAddress: { address }, type: 'required' })),
          transactionId: d.id,
        },
      });
      if (!r.id)
        throw Object.assign(Error('Calendar returned no event ID. Check your calendar.'), {
          uncertain: true,
        });
      return {
        state: 'accepted',
        result:
          'Outlook created the event' +
          (d.recipients.length ? ' and requested attendee notifications.' : '.'),
      };
    }
    if (d.provider === 'zapier') {
      await request(a.webhook, null, {
        method: 'POST',
        write: true,
        plain: true,
        body: {
          event: 'flow.note.reviewed',
          delivery_id: d.id,
          note_id: d.noteId,
          title: d.title,
          body: d.body,
          sent_at: new Date(now()).toISOString(),
        },
      });
      return {
        state: 'accepted',
        result: 'Zapier accepted the hook. Downstream actions must be checked in Zapier.',
      };
    }
    throw Error('Unsupported action.');
  };
  const commit = (p) =>
    serial(async () => {
      check();
      if (p?.reviewed !== true || typeof p.id !== 'string')
        throw Error('Review the destination and content before sending.');
      const all = await vault.read('outbox', []),
        d = all.find((x) => x.id === p.id);
      if (!d || d.state !== 'review')
        throw Error('This action has already been submitted or is unavailable.');
      if (d.start && Date.parse(d.start) < now() - 60000)
        throw Error('The event start time has passed. Prepare a new preview.');
      if (d.expiresAt < now()) throw Error('The preview expired. Prepare a fresh preview.');
      const note = (await workspace.list()).find((x) => x.id === d.noteId);
      if (!note || isTrashed(note) || note.updatedAt !== d.noteRevision)
        throw Error('The source note changed. Prepare a new preview.');
      const a = await auth(d.provider);
      if (a.key !== d.accountKey) throw Error('The connection changed. Prepare a new preview.');
      if (
        all.some(
          (x) =>
            x.id !== d.id &&
            x.fingerprint === d.fingerprint &&
            ['sending', 'sent', 'accepted', 'uncertain'].includes(x.state),
        )
      )
        throw Error('This exact action was already submitted. Check the destination.');
      d.state = 'sending';
      await vault.write('outbox', all);
      let accepted = false;
      try {
        const result = await send(d, a);
        accepted = true;
        Object.assign(d, result);
        d.body = '';
        await vault.write('outbox', all);
        return publicDraft(d);
      } catch (e) {
        d.state = e.uncertain || accepted ? 'uncertain' : 'rejected';
        d.error = String(e.message).slice(0, 400);
        d.body = '';
        await vault.write('outbox', all);
        return publicDraft(d);
      }
    });
  const recover = () =>
    serial(async () => {
      const active = new Set((await workspace.list()).filter((n) => !isTrashed(n)).map((n) => n.id)),
        all = (await vault.read('outbox', [])).filter((d) => active.has(d.noteId));
      for (const d of all) {
        if (d.state === 'sending') {
          d.state = 'uncertain';
          d.error = 'Aeka Scribe closed while this action was sending. Check the destination.';
        }
        if (d.state !== 'review' || d.expiresAt < now()) {
          if (d.state === 'review') d.state = 'expired';
          d.body = '';
        }
      }
      await vault.write('outbox', all);
    });
  const discard = (id) =>
    serial(async () => {
      const all = await vault.read('outbox', []),
        d = all.find((x) => x.id === id);
      if (d?.state === 'review') {
        d.state = 'discarded';
        d.body = '';
        await vault.write('outbox', all);
      }
      return true;
    });
  const mailContext = async (p) => {
    check();
    if (!['google', 'microsoft'].includes(p?.provider)) throw Error('Choose Gmail or Outlook.');
    const addresses = emailAddresses(p.addresses);
    if (addresses.length > 5) throw Error('Choose up to five exact email addresses.');
    const a0 = await calendars.access(p.provider, 'mailRead'),
      a = { header: 'Bearer ' + a0.token };
    let messages = [];
    if (p.provider === 'google') {
      const query = 'newer_than:90d {' + addresses.flatMap((x) => ['from:' + x, 'to:' + x]).join(' ') + '}',
        r = await request(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages?' +
            new URLSearchParams({ q: query, maxResults: '10' }),
          a,
        );
      for (const x of (r.messages || []).slice(0, 10)) {
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(x.id)) continue;
        const d = await request(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/' +
              x.id +
              '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date',
            a,
          ),
          header = (name) =>
            d.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        messages.push({
          id: d.id,
          subject: header('subject'),
          from: header('from'),
          date: header('date'),
          text: d.snippet || '',
        });
      }
    } else {
      const safe = addresses.map((x) => x.replace(/'/g, "''")),
        filter =
          'receivedDateTime ge ' +
          new Date(now() - 90 * 86400000).toISOString() +
          ' and (' +
          safe.map((x) => "from/emailAddress/address eq '" + x + "'").join(' or ') +
          ')',
        r = await request(
          'https://graph.microsoft.com/v1.0/me/messages?' +
            new URLSearchParams({
              $filter: filter,
              $top: '10',
              $select: 'id,subject,from,receivedDateTime,bodyPreview',
            }),
          a,
        );
      messages = (r.value || []).slice(0, 10).map((d) => ({
        id: d.id,
        subject: d.subject,
        from: d.from?.emailAddress?.address || '',
        date: d.receivedDateTime,
        text: d.bodyPreview || '',
      }));
    }
    return {
      account: a0.email,
      messages: messages.map((m) =>
        Object.fromEntries(
          Object.entries(m).map(([k, v]) => [k, String(v || '').slice(0, k === 'text' ? 1500 : 500)]),
        ),
      ),
      coverage:
        p.provider === 'google'
          ? 'Up to 10 Gmail snippets from the past 90 days, to or from these addresses.'
          : 'Up to 10 received Outlook message previews from these senders in the past 90 days. No full threads or attachments.',
    };
  };
  return { status, configure, prepare, commit, list, recover, discard, mailContext };
}
