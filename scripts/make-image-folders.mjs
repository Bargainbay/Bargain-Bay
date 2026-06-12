// One-time helper: create a Drive subfolder per available unit inside the
// "Bargain Bay Images" folder, so the team can drop live photos into each.
// Usage: BB_IMAGES_FOLDER_ID=<folderId> node scripts/make-image-folders.mjs
import { google } from 'googleapis';
import catalog from '../data/catalog.json' assert { type: 'json' };

const parent = process.env.BB_IMAGES_FOLDER_ID;
if (!parent) throw new Error('Set BB_IMAGES_FOLDER_ID');
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/drive'] });
const drive = google.drive({ version: 'v3', auth: await auth.getClient() });

for (const u of catalog) {
  const q = `name='${u.id}' and '${parent}' in parents and trashed=false`;
  const { data } = await drive.files.list({ q, fields: 'files(id)' });
  if (data.files.length) { console.log('exists', u.id); continue; }
  await drive.files.create({
    requestBody: { name: u.id, mimeType: 'application/vnd.google-apps.folder', parents: [parent] },
    fields: 'id'
  });
  console.log('created', u.id);
}
console.log('done');
