// supabase/functions/benny/index.ts — The Benny, the DMS AI (Claude API).
//
// Tasks (POST JSON, signed-in user with the Super Admin › Territory permission):
//   { task: 'map', fileName, rows }            → { mapping }   which column is what in a client list
//   { task: 'fix_addresses', items: [{i,text}] } → { items }   split addresses the app couldn't read
//   { task: 'fetch_sheet', url }               → { csv }       read a Google Sheet shared by link
//
// The Claude API key lives only in the ANTHROPIC_API_KEY secret (Supabase › Edge Functions ›
// Secrets). It never reaches the browser. Client data sent to Claude is limited to the first
// rows of a file (to learn its layout) and to addresses that need splitting.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const MODEL = Deno.env.get('BENNY_MODEL') || 'claude-sonnet-5-5';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const FIELDS = ['ignore', 'first_name', 'last_name', 'full_name', 'house_no', 'street', 'street_address', 'full_address', 'unit', 'city',
  'province', 'postal_code', 'phone', 'email', 'route_code', 'notes', 'call_first', 'do_not_call', 'do_not_text', 'tag',
  'year', 'service', 'price', 'contractor', 'payment', 'serviced'];

const MAP_TOOL = {
  name: 'save_mapping',
  description: 'Save how this client list is laid out.',
  input_schema: {
    type: 'object',
    properties: {
      headerRow: { type: 'integer', description: '0-based index (in the rows given) of the row holding the column titles' },
      columns: {
        type: 'object',
        description: 'One entry per column index ("0", "1", ...), for every column in the header row',
        additionalProperties: {
          type: 'object',
          properties: {
            field: { type: 'string', enum: FIELDS },
            year: { type: ['integer', 'null'], description: 'For history columns that belong to one fixed year, e.g. a "2024 Price" or "2025" column' },
            tag: { type: ['string', 'null'], description: 'For field "tag": the tag name, e.g. "NO SP" or "2nd"' },
            service: { type: ['string', 'null'], description: 'For field "serviced": the service code the column stands for, e.g. "AER"' },
          },
          required: ['field'],
        },
      },
      defaultYear: { type: ['integer', 'null'], description: 'Year for history when the list has no year column (e.g. from the file name)' },
      defaultService: { type: ['string', 'null'], description: 'Service code when the whole list is one service (AER aeration, SS sealing, RJ rejuv, WW windows)' },
      serviceLine: { type: ['string', 'null'], enum: ['aeration', 'lawn_rejuv', 'sealing', 'cleaning', null], description: 'Which service these are past clients of: aeration, sealing (driveway sealing, ramps), lawn_rejuv, or cleaning (window cleaning). From the file name, title or service codes. null only if truly unclear.' },
      defaultCity: { type: ['string', 'null'] },
      defaultProvince: { type: ['string', 'null'], description: 'Two-letter province code' },
      yesValues: { type: 'array', items: { type: 'string' }, description: 'Values in this file that mean yes/serviced besides yes, y, x, 1, true' },
      notes: { type: 'string', description: 'Two to five short plain-English sentences for the person importing: what this list is and anything unusual' },
    },
    required: ['headerRow', 'columns', 'serviceLine', 'notes'],
  },
};

const MAP_SYSTEM = `You are The Benny, the data assistant for Canadian Property Stars, a door-to-door lawn aeration, driveway sealing, lawn rejuvenation and window cleaning company in Canada. You read client lists (callbooks, CRM exports, hand-made sheets) and decide what each column holds, so every row can become one client record per property address with its yearly service history.

Fields:
- People: first_name, last_name, full_name (a single name column; may hold "Lee, Ann" or "Ann & Bob Lee").
- Address: house_no, street (street name, usually with its type), street_address (house # and street together), full_address (street, city and postal code in one cell), unit, city, province, postal_code. route_code is the company's route code if the list has one (e.g. "WO08", "CA01").
- Contact: phone (any phone/cell column; there can be several), email.
- Flags: do_not_call, do_not_text, call_first (a note to call before coming), notes (free-text comments), tag (a short marker column such as "NO SP" or "2nd" — set "tag" to the marker's name).
- History, one entry per year: year (a column holding the service year for that row), service (service type or code, e.g. AER, SS, FP/FO/BO), price, contractor (who did the job), payment (cash, cheque, e-transfer...), serviced (a yes/x flag or a code meaning the property was serviced that year).
- ignore: anything else (internal IDs, formulas, blank columns, totals).

Callbook conventions you will see:
- The same client appears on several rows, one per year, each with a YEAR column: map YEAR to "year"; the rows are combined by address automatically.
- Some lists instead have one column per year ("2023", "2024", "2025" or "AER 2024") holding "yes"/"x" or a code: map each to "serviced" with that "year"; the most recent year may hold the service code itself (e.g. "AER") instead of yes.
- In aeration callbooks the column "FO" holds X for front-only service: map it to "service".
- "PREVIOUS PRICE", "SERVICE AMT" are price; "CONTRACTOR NAME" is contractor; "PMT TYPE" is payment.
- "NO SP" (not interested in the Star Plan) and "2nd" (second service) are tags.
- "HOUSE #" or "PREFIX" is house_no; "STREET NAME" is street.
- Columns that repeat for several years (e.g. "2024 Price", "2025 Price") are history columns with their own "year".
If a column's purpose is unclear, choose "ignore" and say so in notes. Each route keeps a separate past-client list per service, so always say which service the list is for (serviceLine): aeration callbooks (codes AER, FO/FP/BO), sealing callbooks (SS, SSP, SSF, ramp), lawn rejuvenation (RJ), window cleaning (WW). Infer defaultYear from the file name or a title row when there is no year column, and defaultService when the whole list is one service. Give every column index in the header row an entry.`;

async function claude(apiKey: string, body: Record<string, unknown>) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`The Benny couldn’t reach Claude (${res.status}${data?.error?.message ? `: ${data.error.message}` : ''})`);
  return data as { content: { type: string; name?: string; input?: unknown; text?: string }[] };
}

const trimRows = (rows: unknown, maxRows: number) =>
  (Array.isArray(rows) ? rows : []).slice(0, maxRows).map(r => (Array.isArray(r) ? r : []).slice(0, 80).map(c => String(c ?? '').slice(0, 80)));

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: allowed, error: permErr } = await sb.rpc('app_has_perm', { p: 'sa_territory' });
    if (permErr || allowed !== true) return json({ error: 'Not allowed' }, 403);

    const body = await req.json();

    if (body.task === 'fetch_sheet') {
      const m = String(body.url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!m) return json({ error: 'That isn’t a Google Sheet link.' }, 400);
      const gid = String(body.url).match(/[#&?]gid=(\d+)/)?.[1];
      const url = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
      const res = await fetch(url, { redirect: 'follow' });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || type.includes('text/html')) {
        return json({ error: 'Couldn’t open that sheet. Share it as “Anyone with the link can view”, or download it and upload the file.' }, 400);
      }
      const csv = await res.text();
      if (csv.length > 25_000_000) return json({ error: 'That sheet is too big to read by link; download it and upload the file.' }, 400);
      return json({ csv });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'The Benny has no Claude API key yet. Add ANTHROPIC_API_KEY in Supabase › Edge Functions › Secrets.' }, 503);

    if (body.task === 'map') {
      const rows = trimRows(body.rows, 30);
      if (!rows.length) return json({ error: 'No rows to read' }, 400);
      const data = await claude(apiKey, {
        max_tokens: 4096,
        system: MAP_SYSTEM,
        tools: [MAP_TOOL],
        tool_choice: { type: 'tool', name: 'save_mapping' },
        messages: [{ role: 'user', content: `File name: ${String(body.fileName || '').slice(0, 200)}\nFirst rows of the file (JSON, one array per row):\n${JSON.stringify(rows)}` }],
      });
      const use = data.content.find(c => c.type === 'tool_use' && c.name === 'save_mapping');
      if (!use) return json({ error: 'The Benny didn’t return a layout' }, 502);
      return json({ mapping: use.input, model: MODEL });
    }

    if (body.task === 'fix_addresses') {
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 150)
        .map((x: { i: number; text: string }) => ({ i: Number(x.i), text: String(x.text || '').slice(0, 200) }));
      if (!items.length) return json({ items: [] });
      const data = await claude(apiKey, {
        max_tokens: 8192,
        system: 'You split Canadian street addresses into parts. Keep the street name as written (with its type, e.g. "Elm Rd"). If a text is not a street address, leave house_no and street empty. Never invent a house number.',
        tools: [{
          name: 'save_addresses', description: 'Save the split addresses.',
          input_schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'object', required: ['i', 'house_no', 'street'], properties: {
            i: { type: 'integer' }, house_no: { type: 'string' }, street: { type: 'string' }, unit: { type: 'string' },
            city: { type: 'string' }, province: { type: 'string' }, postal_code: { type: 'string' } } } } } },
        }],
        tool_choice: { type: 'tool', name: 'save_addresses' },
        messages: [{ role: 'user', content: JSON.stringify(items) }],
      });
      const use = data.content.find(c => c.type === 'tool_use');
      return json({ items: (use?.input as { items?: unknown[] })?.items || [] });
    }

    return json({ error: 'Unknown task' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
