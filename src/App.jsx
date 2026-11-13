import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngine } from './scene/engine';
import { createAudio } from './audio';
import Poster from './components/Poster';

const START_BOUNTY = 30_000_000;

const POPS = {
  laugh: { kind: 'shi', text: ['シシシッ!', 'シシシ!', 'しししっ'] },
  blush: { kind: 'tere', text: ['照れ…', 'えへへ'] },
  wind: { kind: 'wind', text: ['ビュオォ!'] },
  hatOff: { kind: 'hat', text: ['ぼうし!?'] },
  stretch: { kind: 'gomu', text: ['ゴムゴムの〜!'] },
  catch: { kind: 'catch', text: ['キャッチ!'] },
  don: { kind: 'don', text: ['ドン!!'] },
  meat: { kind: 'meat', text: ['ニク!!', 'うめぇ!'] },
  splash: { kind: 'small', text: ['ちゃぷ'] },
};

const REWARD = {
  laugh: () => (1 + Math.floor(Math.random() * 40)) * 100_000,
  blush: () => 1_000_000,
  meat: () => 12_000_000,
  don: () => 150_000_000,
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export default function App() {
  const stageRef = useRef(null);
  const skyRef = useRef(null);
  const seaRef = useRef(null);
  const engineRef = useRef(null);
  const audioRef = useRef(null);
  if (!audioRef.current) audioRef.current = createAudio();

  const [theme, setTheme] = useState(() => read('luffy-theme', 'night'));
  const [sound, setSound] = useState(false);
  const [ready, setReady] = useState(false);
  const [portrait, setPortrait] = useState(null);
  const [crew, setCrew] = useState(() => read('luffy-crew', { bounty: START_BOUNTY, laugh: 0, gust: 0, meat: 0 }));
  const [bump, setBump] = useState(null);
  const [pops, setPops] = useState([]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'day' ? '#2f7fd6' : '#070b24');
    write('luffy-theme', theme);
    engineRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => { write('luffy-crew', crew); }, [crew]);

  const addPop = useCallback((type, at) => {
    const def = POPS[type];
    if (!def || !at) return;
    const id = Math.random().toString(36).slice(2);
    const text = def.text[(Math.random() * def.text.length) | 0];
    const rot = def.kind === 'don' ? -6 : (Math.random() * 24 - 12);
    setPops(p => [...p.slice(-10), { id, text, kind: def.kind, x: at.x, y: at.y, rot }]);
    window.setTimeout(() => setPops(p => p.filter(q => q.id !== id)), def.kind === 'don' ? 1700 : 1400);
  }, []);

  const reward = useCallback((type) => {
    const amount = REWARD[type]?.();
    if (!amount) return;
    setCrew(c => ({
      ...c,
      bounty: c.bounty + amount,
      laugh: c.laugh + (type === 'laugh' ? 1 : 0),
      gust: c.gust + (type === 'don' ? 1 : 0),
      meat: c.meat + (type === 'meat' ? 1 : 0),
    }));
    setBump({ amount, id: Date.now() });
  }, []);

  // the scene
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const engine = createEngine({
      sky: skyRef.current,
      sea: seaRef.current,
      root: stageRef.current,
      reduced,
      theme: read('luffy-theme', 'night'),
      onEvent(type, at) {
        if (type === 'ready') {
          setReady(true);
          setPortrait(engine.portrait());
          return;
        }
        audioRef.current.play(type);
        addPop(type, at);
        reward(type);
        if (type === 'don' && !reduced) {
          const el = stageRef.current?.querySelector('.world');
          if (el) {
            el.classList.remove('is-shaking');
            void el.offsetWidth;          // restart the animation
            el.classList.add('is-shaking');
          }
        }
      },
    });
    engineRef.current = engine;
    return () => engine.destroy();
  }, [addPop, reward]);

  // keyboard
  useEffect(() => {
    const onKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const eng = engineRef.current;
      if (k === 'l') eng?.laugh();
      else if (k === 'g') eng?.gust();
      else if (k === 'f') eng?.feed();
      else if (k === 't') setTheme(t => (t === 'day' ? 'night' : 'day'));
      else if (k === 'm') toggleSound();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function toggleSound() {
    setSound(s => {
      audioRef.current.setEnabled(!s);
      return !s;
    });
  }

  const night = theme !== 'day';

  return (
    <main ref={stageRef} className={'stage' + (ready ? ' is-ready' : '')}>
      <div className="world" onAnimationEnd={e => e.currentTarget.classList.remove('is-shaking')}>
        <canvas ref={skyRef} className="layer" aria-hidden="true" />
        <div className="wordmark" aria-hidden="true">
          <span className="wordmark__text" data-text="LUFFY">LUFFY</span>
        </div>
        <canvas
          ref={seaRef}
          className="layer layer--sea"
          role="img"
          aria-label="Chibi Luffy sitting in a small wooden boat on the sea. Click him to make him laugh."
        />
      </div>

      <div className="ui">
        <header className="brand">
          <p className="brand__eyebrow"><span>麦わらの一味</span> · Captain · No.001</p>
          <h1 className="brand__title">
            <span className="brand__jp">麦わらのルフィ</span>
            <span className="brand__en">Straw Hat Luffy</span>
          </h1>
        </header>

        <div className="controls">
          <button
            type="button"
            className="chip-btn"
            onClick={() => setTheme(t => (t === 'day' ? 'night' : 'day'))}
            aria-label={night ? 'Switch to a sunny day (T)' : 'Switch to a moonlit night (T)'}
            title={night ? 'Daytime (T)' : 'Night-time (T)'}
          >
            {night ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            type="button"
            className={'chip-btn' + (sound ? ' is-on' : '')}
            onClick={toggleSound}
            aria-pressed={sound}
            aria-label={sound ? 'Mute the sea (M)' : 'Turn sound on (M)'}
            title={sound ? 'Sound on (M)' : 'Sound off (M)'}
          >
            {sound ? <SoundIcon /> : <MuteIcon />}
          </button>
        </div>

        <Poster
          crew={crew}
          bump={bump}
          portrait={portrait}
          onReset={() => setCrew({ bounty: START_BOUNTY, laugh: 0, gust: 0, meat: 0 })}
        />

        <p className="vertical" aria-hidden="true">モンキー・D・ルフィ</p>

        <div className="pops" aria-live="polite">
          {pops.map(p => (
            <span
              key={p.id}
              className={'pop pop--' + p.kind}
              style={{ left: p.x, top: p.y, '--rot': p.rot + 'deg' }}
            >
              {p.text}
            </span>
          ))}
        </div>

      </div>
    </main>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  );
}
function SoundIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}
function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </svg>
  );
}
