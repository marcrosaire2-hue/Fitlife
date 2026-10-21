import { useMemo, useState } from 'react';
import { fitMap } from '../lib/tracker';

const W = 320, H = 220;
const tileUrl = (t) => `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;

/* Tracé du parcours sur un fond OpenStreetMap. Les tuiles sont de simples images : si elles ne se chargent pas
   (hors ligne, bloquées), le tracé reste visible sur le quadrillage. */
export default function RouteMap({ points, live = false, label = 'Parcours' }) {
  const { xy, tiles } = useMemo(() => fitMap(points, W, H, 22), [points]);
  const [failed, setFailed] = useState(0);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const first = xy[0], last = xy[xy.length - 1];
  return (
    <svg className="routemap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <pattern id="rm-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" className="rm-g" /></pattern>
      </defs>
      <rect width={W} height={H} fill="url(#rm-grid)" />
      {tiles.map((t) => (
        <image
          key={`${t.z}/${t.x}/${t.y}`} href={tileUrl(t)} x={t.left} y={t.top} width="256.5" height="256.5"
          referrerPolicy="strict-origin-when-cross-origin" onError={() => setFailed((n) => n + 1)}
        />
      ))}
      {xy.length === 0 && <text x={W / 2} y={H / 2} className="rm-empty" textAnchor="middle">{live ? 'Ton parcours apparaîtra ici' : 'Aucun parcours GPS enregistré'}</text>}
      {xy.length > 1 && <polyline points={line} className="rm-case" />}
      {xy.length > 1 && <polyline points={line} className="rm-line" />}
      {first && <circle cx={first[0]} cy={first[1]} r="6" className="rm-start" />}
      {last && xy.length > 1 && <circle cx={last[0]} cy={last[1]} r={live ? 7 : 6} className={live ? 'rm-now' : 'rm-end'} />}
      {tiles.length > 0 && (
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          <rect x={W - 142} y={H - 15} width="142" height="15" className="rm-attr-bg" />
          <text x={W - 5} y={H - 4.5} textAnchor="end" className="rm-attr">© OpenStreetMap contributors</text>
        </a>
      )}
      {failed > 0 && failed >= tiles.length && <text x={6} y={14} className="rm-off">Carte indisponible hors ligne</text>}
    </svg>
  );
}
