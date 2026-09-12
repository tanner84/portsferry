import { google } from 'googleapis';
import { handleCorrection } from './_shared/correction-service.mjs';

// Same endpoint and password as the previous importer; changes require a preview.
export default async (request: Request) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (request.method !== 'POST') return json(405, { error: 'Use POST.' });
  const password = Netlify.env.get('ADMIN_PASSWORD');
  if (!password || request.headers.get('x-admin-password') !== password) return json(401, { error: 'Unauthorized' });
  const spreadsheetId = Netlify.env.get('GOOGLE_SHEETS_ID');
  const email = Netlify.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  const key = (Netlify.env.get('GOOGLE_PRIVATE_KEY') || '').replace(/\\n/g, '\n');
  if (!spreadsheetId || !email || !key) return json(503, { error: 'Google Sheets configuration is incomplete.' });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2_000_000) return json(413, { error: 'Split this import into smaller batches.' });
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const api = google.sheets({ version: 'v4', auth });
    const result = await handleCorrection({ api, spreadsheetId, secret: password, body: JSON.parse(raw) });
    return json(result.status, result.body);
  } catch {
    return json(400, { error: 'Unable to process the request. Check JSON and verify the audit log before retrying.' });
  }
};
