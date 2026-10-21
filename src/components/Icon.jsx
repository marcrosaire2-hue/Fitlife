const P = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 1 2-2h13" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.500 2.700-5.500 6-5.500s6 2 6 5.500M16 5a3 3 0 0 1 0 6M21 20c0-2.500-1.500-4.300-3.500-5" /></>,
  heart: <path d="M12 20s-8-4.800-8-10.500A4.500 4.500 0 0 1 12 7a4.500 4.500 0 0 1 8 2.500C20 15.200 12 20 12 20z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.500-6 8-6s8 2 8 6" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  play: <path d="M7 4l13 8-13 8z" />,
  pause: <path d="M8 5v14M16 5v14" strokeWidth="3.500" />,
  clock: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></>,
  fire: <path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-2.500 1.200-4 2.500-5 .2 2 1.200 3 2.500 3-.5-3 .5-6 1-9z" />,
  check: <path d="M5 12.500l4.500 4.500L19 7.500" strokeWidth="3" />,
  next: <path d="M5 5l9 7-9 7zM18 5v14" />,
  music: <><path d="M9 18V6l11-2v12" /><circle cx="6.500" cy="18" r="2.500" /><circle cx="17.500" cy="16" r="2.500" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  star: <path d="M12 3l2.700 5.600 6.100.9-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100L3.200 9.500l6.100-.9z" fill="currentColor" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  flame: <path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-2.500 1.200-4 2.500-5 .2 2 1.200 3 2.500 3-.5-3 .5-6 1-9z" fill="currentColor" />,
  trophy: <path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
};
export default function Icon({ n, className = '' }) {
  return <svg className={'ic ' + className} viewBox="0 0 24 24" aria-hidden="true">{P[n]}</svg>;
}
