import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useSyncFavs } from '../components/RequireAuth';
import { BackBtn, CourseRow, Empty, SearchBox, WorkoutRow } from '../components/ui';
import { Img } from '../components/Media';

const BASE = import.meta.env.BASE_URL;
const withBase = (o) => ({ ...o, photo: `${BASE}${o.photo}` });

function ErrorBox({ title, message, onRetry }) {
  return (
    <div className="state-box center" role="alert">
      <b>{title}</b><p>{message}</p>
      <button className="btn" onClick={onRetry}>Try again</button>
    </div>
  );
}
const Rows = ({ n }) => <div className="lst grid px" aria-busy="true" aria-label="Loading">{[...Array(n)].map((_, i) => <div key={i} className="row skeleton" />)}</div>;

export function Courses() {
  const [q, setQ] = useState('');
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState('');
  const stamp = useRef(0);

  const load = useCallback((query) => {
    const id = ++stamp.current;
    setError('');
    api.courses(query.trim())
      .then((d) => { if (id === stamp.current) setCourses(d.courses.map(withBase)); })
      .catch((e) => { if (id === stamp.current) setError(e.message); });
  }, []);

  // premier chargement immédiat, ensuite recherche avec un court délai
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; load(''); return; }
    const h = setTimeout(() => load(q), 250);
    return () => clearTimeout(h);
  }, [q, load]);

  return (
    <section className="page">
      <div className="topbar"><BackBtn /><h2>Courses</h2><span className="sp" /></div>
      <div className="px"><SearchBox value={q} onChange={setQ} placeholder="Search a course" /></div>
      <div style={{ marginTop: 14 }}>
        {error ? <ErrorBox title="We couldn't load the courses" message={error} onRetry={() => load(q)} />
          : !courses ? <Rows n={5} />
          : <div className="lst grid px" aria-live="polite">{courses.length ? courses.map((c) => <CourseRow key={c.id} c={c} />) : <Empty>No course found.</Empty>}</div>}
      </div>
    </section>
  );
}

const LEVELS = ['All', 'Beginner', 'Intermediate', 'Advanced'];
const SORTS = [['default', 'Default'], ['kcal', 'Most calories'], ['time', 'Shortest']];

export function CourseDetail() {
  const { id } = useParams();
  const [level, setLevel] = useState('All');
  const [sort, setSort] = useState('default');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const stamp = useRef(0);

  const load = useCallback(() => {
    const n = ++stamp.current;
    setError(''); setBusy(true);
    api.course(id, { level, sort })
      .then((d) => { if (n === stamp.current) { setData({ course: withBase(d.course), workouts: d.workouts.map(withBase), total: d.total }); setBusy(false); } })
      .catch((e) => { if (n !== stamp.current) return; if (e.status === 404) setMissing(true); else { setError(e.message); setBusy(false); } });
  }, [id, level, sort]);
  useEffect(load, [load]);
  useEffect(() => { setData(null); setLevel('All'); setSort('default'); }, [id]);
  useSyncFavs(data?.workouts);

  if (missing) return <Navigate to="/courses" replace />;
  const c = data?.course;
  return (
    <section className="page">
      <div className="course-hero">
        {c ? <Img src={c.photo} pos="center 25%" /> : <div className="art skeleton" />}
        <div className="shade" />
        <div className="tb"><BackBtn glass /></div>
        <h1>{c?.name ?? ''}</h1>
      </div>
      <div className="chips px" role="group" aria-label="Level">
        {LEVELS.map((l) => <button key={l} className={'chip' + (level === l ? ' on' : '')} aria-pressed={level === l} onClick={() => setLevel(l)}>{l}</button>)}
      </div>
      <div className="chips px" role="group" aria-label="Sort">
        {SORTS.map(([k, l]) => <button key={k} className={'chip small' + (sort === k ? ' on' : '')} aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>)}
      </div>
      <div style={{ marginTop: 12, opacity: busy && data ? 0.55 : 1, transition: 'opacity .2s' }}>
        {error ? <ErrorBox title="We couldn't load this course" message={error} onRetry={load} />
          : !data ? <Rows n={3} />
          : <div className="lst grid px" aria-live="polite">
              {data.workouts.length ? data.workouts.map((w) => <WorkoutRow key={w.id} w={w} />)
                : <Empty>{data.total ? 'No workout for this level yet.' : 'No workout in this course yet.'}</Empty>}
            </div>}
      </div>
    </section>
  );
}
