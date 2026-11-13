import { useEffect, useRef, useState } from 'react';

const fmt = n => Math.round(n).toLocaleString('en-US');

/** eases the shown number toward the real bounty, like a rolling counter */
function useRolling(value) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const dur = Math.min(1400, 500 + Math.log10(Math.abs(value - a) + 10) * 110);
    let raf;
    const step = now => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 4);
      const v = a + (value - a) * e;
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

export default function Poster({ crew, bump, portrait, onReset }) {
  const shown = useRolling(crew.bounty);
  return (
    <aside className="poster" aria-label={`Wanted poster. Bounty ${fmt(crew.bounty)} berries`}>
      <div className="poster__paper">
        <p className="poster__wanted">WANTED</p>
        <div className="poster__photo">
          {portrait ? <img src={portrait} alt="" width="280" height="280" /> : <span className="poster__blank" />}
        </div>
        <p className="poster__name">MONKEY · D · LUFFY</p>
        <p className="poster__bounty">
          <span className="poster__berry">฿</span>
          <span className="poster__num">{fmt(shown)}</span>
          <span className="poster__dash">-</span>
        </p>
        <p className="poster__stats">
          <span>{crew.laugh} laughs</span>
          <span>{crew.gust} gusts</span>
          <span>{crew.meat} meat</span>
        </p>
        {bump && (
          <span key={bump.id} className="poster__bump" aria-hidden="true">+{fmt(bump.amount)}</span>
        )}
        <button type="button" className="poster__reset" onClick={onReset} aria-label="Reset the bounty" title="Reset bounty">↺</button>
      </div>
    </aside>
  );
}
