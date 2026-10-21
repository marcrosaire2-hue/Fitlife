// Envoie les photos du dossier public/media/photos vers le bucket Supabase (chemin conservé : media/photos/<fichier>).
// Usage : npm run migrate:media     (SUPABASE_URL, SUPABASE_SERVICE_KEY et SUPABASE_BUCKET doivent être dans .env)
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'fitlife';
if (!URL_ || !KEY) { console.error('SUPABASE_URL et SUPABASE_SERVICE_KEY doivent être renseignés dans .env'); process.exit(1); }

const headers = (extra = {}) => ({ apikey: KEY, ...(KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${KEY}` }), ...extra });
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'media', 'photos');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

// le bucket doit exister (public)
const b = await fetch(`${URL_}/storage/v1/bucket`, {
  method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }),
});
if (!b.ok && !/already exists|Duplicate/i.test(await b.text())) { console.error(`Impossible de préparer le bucket (${b.status}). Vérifie la clé.`); process.exit(1); }

let ok = 0, failed = 0;
for (const f of readdirSync(dir)) {
  const mime = MIME[extname(f).toLowerCase()];
  if (!mime) continue;
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/media/photos/${f}`, {
    method: 'POST', headers: headers({ 'Content-Type': mime, 'x-upsert': 'true', 'Cache-Control': '31536000' }), body: readFileSync(join(dir, f)),
  });
  if (r.ok) { ok++; console.log('✓', f); } else { failed++; console.log('✗', f, r.status); }
}
console.log(`\n${ok} photo(s) envoyée(s), ${failed} échec(s).`);
console.log(`Adresse publique : ${URL_}/storage/v1/object/public/${BUCKET}/media/photos/<fichier>`);
if (!failed) console.log('Ajoute maintenant VITE_ASSETS_BASE dans .env (adresse ci-dessus, sans /media/photos), relance le site, puis tu pourras supprimer public/media/photos.');
process.exit(failed ? 1 : 0);
