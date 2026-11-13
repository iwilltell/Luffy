/*
  Luffy sprite controller.

  Every atlas frame is placed in one "plate" space (the 1280x720 source frame of
  the front-facing pose), so the controller only decides WHICH frame shows and
  how two frames dissolve; the engine decides where the plate sits on screen.
*/

// head-turn ramps: index 0 is facing front, the last index is the full turn
export const RIGHT = [12, 3, 4, 5, 6];       // head turning toward screen-right
export const LEFT = [12, 23, 22, 17, 19];    // head turning toward screen-left
const FRONT = 12;
const BLINK = [[15, 0.05], [16, 0.075], [15, 0.05]];
const BLUSH = [26, 27, 28];
const LAUGH = range(29, 38);
const LAUGH_LOOP = range(31, 38);
const GUST = range(39, 62);
const GRIN = range(64, 69);

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export function createLuffy(emit) {
  const st = {
    mode: 'idle',           // idle | blush | laugh | gust
    shown: FRONT,
    prev: FRONT,
    fade: 1,
    fadeDur: 0.1,
    turn: 0,                // signed ramp index, -4..4
    blink: null,            // { step, t }
    blinkAt: 2.4,
    seq: null,              // { frames, fps, i, t, hold, onFrame, done }
    laughMore: 0,
    time: 0,
  };

  function show(f, fadeDur = 0.09) {
    if (f === st.shown) return;
    st.prev = st.fade < 0.5 ? st.prev : st.shown;
    st.shown = f;
    st.fade = fadeDur > 0 ? 0 : 1;
    st.fadeDur = fadeDur;
  }

  function play(frames, fps, opts = {}) {
    st.seq = { frames, fps, i: 0, t: 0, hold: opts.hold || 0, onFrame: opts.onFrame, done: opts.done };
    st.blink = null;
    show(frames[0], opts.fadeIn ?? 0.05);
    if (opts.onFrame) opts.onFrame(frames[0]);
  }

  function backToIdle(fadeDur = 0.16) {
    st.mode = 'idle';
    st.seq = null;
    st.turn = 0;
    show(FRONT, fadeDur);
    st.blinkAt = st.time + 1.6 + Math.random() * 2;
  }

  const api = {
    get mode() { return st.mode; },
    get state() { return st; },

    laugh() {
      if (st.mode === 'gust') return false;
      if (st.mode === 'laugh') {
        st.laughMore = Math.min(st.laughMore + 1, 2);
        return true;
      }
      st.mode = 'laugh';
      st.laughMore = 0;
      const next = () => {
        if (st.laughMore > 0) {
          st.laughMore--;
          play(LAUGH_LOOP, 14, { fadeIn: 0, done: next });
        } else {
          backToIdle(0.14);
        }
      };
      play(LAUGH, 14, { done: next });
      return true;
    },

    gust() {
      if (st.mode === 'gust') return false;
      st.mode = 'gust';
      play(GUST, 13, {
        fadeIn: 0.08,
        onFrame: f => {
          if (f === 39) emit('wind');
          if (f === 43) emit('hatOff');
          if (f === 47) emit('stretch');
          if (f === 56) emit('catch');
        },
        done: () => {
          play([63], 1, {
            fadeIn: 0,
            hold: 0.32,
            onFrame: () => emit('don'),
            done: () => play(GRIN, 9, { fadeIn: 0, hold: 0.9, done: () => backToIdle(0.26) }),
          });
        },
      });
      return true;
    },

    /** hovering on him long enough: he goes shy */
    blush(on) {
      if (on && st.mode === 'idle' && Math.abs(st.turn) <= 1) {
        st.mode = 'blush';
        play(BLUSH, 9, { fadeIn: 0.12, hold: Infinity });
        emit('blush');
      } else if (!on && st.mode === 'blush') {
        backToIdle(0.2);
      }
    },

    /** u: -1 (cursor far left) .. 1 (far right), already smoothed by the engine */
    update(dt, u) {
      st.time += dt;

      if (st.fade < 1) st.fade = Math.min(1, st.fade + dt / st.fadeDur);

      // reaction sequences
      const q = st.seq;
      if (q) {
        q.t += dt;
        const step = 1 / q.fps;
        while (q.t >= step && st.seq === q) {
          if (q.i < q.frames.length - 1) {
            q.t -= step;
            q.i++;
            show(q.frames[q.i], 0);
            if (q.onFrame) q.onFrame(q.frames[q.i]);
          } else if (q.t >= step + q.hold) {
            st.seq = null;
            if (q.done) q.done();
          } else {
            break;
          }
        }
        return;
      }

      if (st.mode !== 'idle') return;

      // continuous head follow, with hysteresis so it never flickers between two drawings
      const pos = Math.max(-1, Math.min(1, u)) * (RIGHT.length - 1);
      if (Math.abs(pos - st.turn) > 0.62) {
        st.turn += Math.sign(pos - st.turn);
      }
      const base = st.turn >= 0 ? RIGHT[st.turn] : LEFT[-st.turn];

      // blinking, only when looking (almost) straight ahead
      if (st.blink) {
        st.blink.t += dt;
        const [, d] = BLINK[st.blink.step];
        if (st.blink.t >= d) {
          st.blink.t = 0;
          st.blink.step++;
          if (st.blink.step >= BLINK.length) {
            st.blink = null;
            st.blinkAt = st.time + 2 + Math.random() * 3.6;
            show(base, 0.05);
            return;
          }
        }
        show(BLINK[st.blink.step][0], 0);
        return;
      }
      if (st.turn === 0 && st.time >= st.blinkAt && st.fade >= 1) {
        st.blink = { step: 0, t: 0 };
        show(BLINK[0][0], 0);
        return;
      }
      if (st.turn !== 0) st.blinkAt = Math.max(st.blinkAt, st.time + 0.8);
      show(base, 0.14);
    },

    /** [[frame, alpha], ...] to draw this instant, back to front */
    layers() {
      if (st.fade >= 1) return [[st.shown, 1]];
      const e = st.fade;
      return [[st.prev, Math.min(1, 2 * (1 - e))], [st.shown, Math.min(1, 2 * e)]];
    },
  };
  return api;
}
