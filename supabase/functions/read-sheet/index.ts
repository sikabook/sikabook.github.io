// SikaBook — read a photo of a handwritten service sheet with Google Gemini.
// The Gemini key lives only here (Supabase secret GEMINI_API_KEY); the app never sees it.
// Only signed-in people who can record money in some unit may use it. Photos are not stored.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
const num = { type: 'NUMBER', nullable: true };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    date: { type: 'STRING', nullable: true, description: 'Date written on the sheet as YYYY-MM-DD, or null' },
    service: { type: 'STRING', nullable: true, description: 'Service name if written, e.g. Sunday service, Evening service' },
    items: {
      type: 'ARRAY', description: 'Income lines (not Day Born groups)',
      items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, amount: { type: 'NUMBER' } }, required: ['name', 'amount'] },
    },
    dayborn: {
      type: 'OBJECT', nullable: true, description: 'Day Born offering per day group, if present',
      properties: { sunday: num, monday: num, tuesday: num, wednesday: num, thursday: num, friday: num, saturday: num, unknown: num },
    },
    expenses: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { paid_to: { type: 'STRING' }, purpose: { type: 'STRING' }, amount: { type: 'NUMBER' } }, required: ['purpose', 'amount'] },
    },
    counters: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Names of people who counted/signed, if written' },
    unsure: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Labels of any numbers that were hard to read' },
  },
  required: ['items', 'expenses'],
};

function prompt(items: string[]) {
  return `You are reading a photo of a handwritten finance record from a church service in Ghana (amounts in Ghana cedis).
Extract the numbers exactly as written. Do not invent or estimate values; if a number cannot be read, leave it out and add its label to "unsure".

Income lines: put each in "items" with the name as written. The church usually records these items: ${items.join(', ')}.
Use those names when a line clearly matches one (e.g. "Thanksg." -> "Thanksgiving", "Off." -> "Offering").

Day Born offering ("day born", "dayborn", "day bones") is split into 8 groups. Put these in "dayborn", NOT in "items":
sunday = Kwasi / Akosua / Sunday; monday = Kwadwo / Adwoa / Monday; tuesday = Kwabena / Abena / Tuesday;
wednesday = Kwaku / Akua / Wednesday; thursday = Yaw / Yaa / Thursday; friday = Kofi / Afua / Friday;
saturday = Kwame / Amma / Saturday; unknown = "no day name", "others", "unknown".
Ignore any grand total lines (the app adds the totals itself).

Expenses / payments / "paid out" lines go in "expenses" with who was paid (if written) and what for.
Amounts must be plain numbers without currency signs (e.g. "GH¢ 1,250.50" -> 1250.5).`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  try {
    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) return json({ error: 'Photo reading is not switched on yet (missing GEMINI_API_KEY).' }, 503);

    // Who is asking? Must be signed in and able to record money somewhere.
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: 'Please sign in again.' }, 401);
    const { data: roles } = await sb.from('org_users').select('role').eq('user_id', user.id);
    if (!roles?.some((r: { role: string }) => ['admin', 'finsec', 'treasurer'].includes(r.role))) {
      return json({ error: 'Your account cannot record money.' }, 403);
    }

    const body = await req.json();
    const image: string = body?.image ?? '';
    const mime: string = body?.mime ?? 'image/jpeg';
    const items: string[] = Array.isArray(body?.items) ? body.items.slice(0, 30).map(String) : [];
    if (!image || image.length > 8_000_000) return json({ error: 'Photo missing or too large.' }, 400);
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(mime)) return json({ error: 'Unsupported image type.' }, 400);

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt(items) }, { inline_data: { mime_type: mime, data: image } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    });
    const out = await r.json();
    if (!r.ok) {
      console.error('gemini error', r.status, JSON.stringify(out).slice(0, 500));
      return json({ error: r.status === 429 ? 'Too many photos right now. Wait a minute and try again.' : 'The photo reader is not available right now.' }, 502);
    }
    const text = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    let parsed;
    try { parsed = JSON.parse(text); } catch { return json({ error: 'Could not read that photo. Try a clearer, brighter picture.' }, 422); }
    return json({ result: parsed, model: MODEL });
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong reading the photo.' }, 500);
  }
});
