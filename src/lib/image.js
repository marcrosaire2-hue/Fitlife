/* Prépare une image choisie par l'utilisateur avant l'envoi : décodage, réduction, JPEG.
   Le passage par un canvas supprime les métadonnées (EXIF, position GPS) de la photo d'origine. */
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* repli ci-dessous */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('decode')); i.src = url; });
  } finally { URL.revokeObjectURL(url); }
}
const w = (i) => i.naturalWidth || i.width, h = (i) => i.naturalHeight || i.height;

/**
 * square : recadre au carré et sort `size` × `size` (photo de profil).
 * sinon : conserve les proportions, côté le plus long = `size` au maximum.
 */
export async function prepareImage(file, { size = 1600, square = false, quality = 0.86 } = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error("Choisis un fichier image (JPEG, PNG ou WebP).");
  if (file.size > 25 * 1024 * 1024) throw new Error('Cette image est trop lourde (25 Mo maximum).');
  let img;
  try { img = await decode(file); } catch { throw new Error("Ce format d'image n'est pas pris en charge. Utilise un JPEG, PNG ou WebP."); }
  const sw = w(img), sh = h(img);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (square) {
    const s = Math.min(sw, sh);
    canvas.width = canvas.height = Math.min(size, s);
    ctx.drawImage(img, (sw - s) / 2, (sh - s) / 2, s, s, 0, 0, canvas.width, canvas.height);
  } else {
    const k = Math.min(1, size / Math.max(sw, sh));
    canvas.width = Math.round(sw * k); canvas.height = Math.round(sh * k);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  img.close?.();
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', quality));
  if (!blob) throw new Error("Impossible de préparer l'image.");
  return blob;
}
