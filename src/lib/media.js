/* Liens de médias saisis par l'admin : chemin du site (media/...) ou lien http(s) */
const BASE = import.meta.env.BASE_URL;
// Si VITE_ASSETS_BASE est défini (adresse publique du bucket Supabase), les chemins « media/… » y sont lus ;
// sinon ils sont lus dans le dossier public du site.
const ASSETS = (import.meta.env.VITE_ASSETS_BASE || '').replace(/\/+$/, '');
export const assetUrl = (p) => {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  return ASSETS && p.startsWith('media/photos/') ? `${ASSETS}/${p}` : `${BASE}${p}`;
};

const YT = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/i;

/** 'youtube' | 'vimeo' | 'file' (fichier vidéo lisible directement) | null (pas de vidéo) */
export function videoKind(u) {
  if (!u) return null;
  if (YT.test(u)) return 'youtube';
  if (VIMEO.test(u)) return 'vimeo';
  return 'file';
}
/** Adresse d'intégration (iframe) d'une vidéo YouTube / Vimeo, sinon null */
export function embedUrl(u) {
  let m = YT.exec(u || '');
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = VIMEO.exec(u || '');
  return m ? `https://player.vimeo.com/video/${m[1]}` : null;
}
