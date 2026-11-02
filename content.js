(() => {
  'use strict';

  // ===========================================================================
  // Constants & settings
  // ===========================================================================

  // Speed ladder: 0.25× … 5× in 0.25× steps, then 10×.
  const STEPS = [];
  for (let i = 1; i <= 20; i++) STEPS.push(i / 4);
  STEPS.push(10);
  const START_SPEED = 2;
  const NORMAL = 1;
  const EPS = 0.001;
  const TICK_MS = 25;

  // Silence skipping is driven by a single "style" knob (0–4):
  //   0 = Gentle: catches short pauses, passes them at 4×
  //   4 = Fast:   waits for clear pauses, passes them at 8×
  const SILENCE_LEVELS = 4;
  const GENTLE = { ratio: 0.40, minSilence: 150, speed: 4 };
  const FAST = { ratio: 0.18, minSilence: 350, speed: 8 };
  const MIN_GAP_DB = 5;     // threshold never closer than this to the noise floor
  const EXIT_BIAS_DB = 2;   // leave skip mode slightly earlier than we enter it
  const WARMUP_MS = 1200;   // learn the level of a new video before acting

  // Smart speed keeps the perceived pace of speech constant.
  const SMART_MIN = 0.75;          // never slower than 75% of the chosen speed
  const SMART_MAX = 1.3;           // never faster than 130% of the chosen speed
  const SMART_SMOOTH_MS = 1500;    // time constant of speed changes
  const SMART_STEP = 0.05;         // rate granularity
  const LOOKBEHIND_MS = 1000;      // caption window around the playhead
  const LOOKAHEAD_MS = 7000;
  const REF_CPS = 13;              // typical spoken characters/second (Latin scripts)

  const settings = {
    enabled: true,
    overlay: true,
    silenceSkip: false,
    silenceLevel: 2,
    smartSpeed: false,
    skipSegments: false,
    remaining: true,
  };

  // ===========================================================================
  // Helpers
  // ===========================================================================

  const msg = (key, subs) => {
    try { return chrome.i18n.getMessage(key, subs) || key; } catch { return key; }
  };
  const getPlayer = () => document.querySelector('#movie_player');
  const getVideo = () =>
    document.querySelector('#movie_player video.html5-main-video') ||
    document.querySelector('video.html5-main-video');
  const format = (s) => `${Number(s.toFixed(2))}×`;
  const same = (a, b) => Math.abs(a - b) < EPS;
  const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
  const isAd = () => !!getPlayer()?.classList.contains('ad-showing');
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  function currentVideoId() {
    const u = new URL(location.href);
    return u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/) || [])[1] || null;
  }

  function silenceProfile() {
    const k = clamp(Number(settings.silenceLevel) || 0, 0, SILENCE_LEVELS) / SILENCE_LEVELS;
    const mix = (a, b) => a + (b - a) * k;
    return {
      ratio: mix(GENTLE.ratio, FAST.ratio),
      minSilence: mix(GENTLE.minSilence, FAST.minSilence),
      speed: Math.round(mix(GENTLE.speed, FAST.speed)),
    };
  }

  // ===========================================================================
  // Rate controller
  //
  // locked      speed chosen with Tempo (null = follow YouTube's own speed)
  // nativeBase  YouTube's own speed (menu, hold-Space 2×), tracked while unlocked
  // skipping    fast-forwarding through silence
  // smartFactor smart speed multiplier around the chosen speed (1 = neutral)
  // expected    rate we currently enforce (null = we leave the rate alone)
  //
  // Every rate change Tempo makes is hidden from YouTube, so the player never
  // adopts a temporary speed as the user's preference.
  // ===========================================================================

  let locked = null;
  let nativeBase = NORMAL;
  let skipping = false;
  let smartFactor = 1;
  let expected = null;
  let lastNativeInteraction = 0;

  const userBase = () => (locked !== null ? locked : nativeBase);
  const skipSpeed = () => Math.max(userBase(), silenceProfile().speed);
  const managing = () => locked !== null || skipping || smartFactor !== 1;

  function targetRate() {
    if (skipping) return skipSpeed();
    const r = userBase() * smartFactor;
    return smartFactor === 1 ? r : clamp(Number((Math.round(r / SMART_STEP) * SMART_STEP).toFixed(2)), 0.25, 16);
  }

  // Rates we set ourselves, waiting for their ratechange event to be hidden.
  // Matched by value, so a different rate set by YouTube is never swallowed.
  const pendingHidden = []; // { rate, at }
  // Temporary rates (silence skip, smart speed) we applied recently. YouTube can
  // read the element's rate directly when it starts the next video; if it then
  // applies one of these, it is a leak and must not become the user's speed.
  const tempRates = new Map(); // rate -> last time applied (ms)
  const TEMP_RATE_MEMORY = 20000;
  function rememberTemp(rate) {
    if (!same(rate, userBase())) tempRates.set(rate, Date.now());
  }
  function isLeakedRate(rate) {
    if (Date.now() - lastNativeInteraction < 1500 || same(rate, userBase())) return false;
    // YouTube's own controls never go above 4×: anything faster that we did not
    // set is a leftover from silence skipping (e.g. remembered across a reload).
    if (rate > 4 + EPS && locked === null) return true;
    for (const [r, at] of tempRates) {
      if (Date.now() - at > TEMP_RATE_MEMORY) tempRates.delete(r);
      else if (same(r, rate)) return true;
    }
    return false;
  }

  // Ask YouTube's own player to remember the right speed, so its internal
  // state never keeps a temporary rate.
  let correctingUntil = 0;
  let correctingRate = null;
  function correctYouTubeRate(rate) {
    correctingRate = rate;
    correctingUntil = Date.now() + 1500;
    window.postMessage({ __tempo: 'content', type: 'set-rate', rate }, location.origin);
  }

  function setRate(v, rate) {
    if (!v || same(v.playbackRate, rate)) return;
    rememberTemp(rate);
    pendingHidden.push({ rate, at: Date.now() });
    v.playbackRate = rate;
  }
  window.addEventListener('ratechange', (e) => {
    if (e.target !== getVideo()) return;
    const now = Date.now();
    while (pendingHidden.length && now - pendingHidden[0].at > 1000) pendingHidden.shift();
    const i = pendingHidden.findIndex((p) => same(p.rate, e.target.playbackRate));
    if (i !== -1) {
      pendingHidden.splice(0, i + 1); // older entries were superseded
      e.stopImmediatePropagation();
    }
  }, true);

  function sync() {
    const v = getVideo();
    if (!managing()) {
      if (expected !== null) {
        expected = null;
        setRate(v, nativeBase);
      }
      return;
    }
    expected = targetRate();
    setRate(v, expected);
  }

  function setSpeed(s) {
    locked = same(s, NORMAL) ? null : s;
    if (locked === null) nativeBase = NORMAL;
    sync();
    if (!managing()) setRate(getVideo(), NORMAL);
    watch.resetRate();
    remaining.update();
    showOverlay(s);
  }

  function release() {
    locked = null;
    skipping = false;
    smartFactor = 1;
    smart.reset();
    showSkipBadge(false);
    sync();
  }

  function step(dir) {
    if (dir > 0 && locked === null) return setSpeed(START_SPEED);
    const cur = locked === null ? NORMAL : locked;
    const i = STEPS.findIndex((s) => same(s, cur));
    setSpeed(STEPS[clamp(i + dir, 0, STEPS.length - 1)]);
  }

  function startSkip() {
    if (skipping || skipSpeed() <= userBase() * smartFactor + EPS) return;
    skipping = true;
    sync();
    showSkipBadge(true);
  }

  function stopSkip() {
    if (!skipping) return;
    skipping = false;
    sync();
    showSkipBadge(false);
  }

  // Rate changes we did not make.
  document.addEventListener('ratechange', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || v !== getVideo()) return;
    const rate = v.playbackRate;

    // Our own correction of YouTube's internal rate: keep enforcing our target.
    if (correctingRate !== null && Date.now() < correctingUntil && same(rate, correctingRate)) {
      correctingRate = null;
      if (expected !== null) setRate(v, expected);
      return;
    }

    // YouTube carried a temporary rate (e.g. silence skip 8×) into a new video.
    if (isLeakedRate(rate)) {
      if (skipping) { skipping = false; showSkipBadge(false); }
      if (managing()) { expected = targetRate(); setRate(v, expected); }
      else { expected = null; setRate(v, nativeBase); }
      correctYouTubeRate(nativeBase);
      return;
    }

    if (expected === null) { nativeBase = rate; return; } // YouTube controls speed
    if (same(rate, expected)) return;

    if (Date.now() - lastNativeInteraction < 1500 || locked === null) {
      // User picked a speed in YouTube's menu, used hold-Space 2×, or YouTube
      // reset the speed for a new video: adopt it as the base speed.
      if (Date.now() - lastNativeInteraction < 1500) locked = null;
      nativeBase = rate;
      if (skipping) { skipping = false; showSkipBadge(false); }
      detector.cooldown();
      smart.cooldown();
      if (managing()) { expected = targetRate(); setRate(v, expected); }
      else expected = null;
      return;
    }
    setRate(v, expected); // locked speed: undo YouTube's reset
  }, true);

  for (const ev of ['loadedmetadata', 'play']) {
    document.addEventListener(ev, (e) => { if (e.target === getVideo()) sync(); }, true);
  }

  // A new video is loading: never carry temporary speeds over.
  function onNewVideo() {
    skipping = false;
    smartFactor = 1;
    showSkipBadge(false);
    detector.reset();
    smart.reset();
    savedVideo = 0;
    watch.reset();
    sync();
  }
  for (const ev of ['emptied', 'loadstart']) {
    document.addEventListener(ev, (e) => { if (e.target === getVideo()) onNewVideo(); }, true);
  }
  // Leaving the page or the video ending: drop temporary speeds immediately, so
  // nothing fast is left on the element when YouTube prepares the next video.
  function dropTemporary() {
    stopSkip();
    if (smartFactor !== 1) { smartFactor = 1; smart.reset(); sync(); }
  }
  window.addEventListener('yt-navigate-start', dropTemporary);
  document.addEventListener('ended', (e) => { if (e.target === getVideo()) dropTemporary(); }, true);
  document.addEventListener('pause', (e) => { if (e.target === getVideo()) stopSkip(); }, true);

  window.addEventListener('yt-navigate-finish', () => {
    onNewVideo();
    captions.request();
    segments.request();
    snackbar.hide();
    setTimeout(sync, 300);
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.ytp-settings-menu')) lastNativeInteraction = Date.now();
  }, true);

  // ===========================================================================
  // Captions: per-word timing from YouTube's timed text (json3)
  // ===========================================================================

  const captions = (() => {
    const store = new Map(); // videoId -> { words, timed, videoCps, scriptFactor }
    const missing = new Map(); // videoId -> reason
    const requested = new Set();

    const LETTERS = /[\p{L}\p{N}]/gu;
    const DENSE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
    const clean = (s) => (s || '').replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ');
    const letters = (s) => (clean(s).match(LETTERS) || []).length;

    function parse(text) {
      const data = JSON.parse(text);
      const words = [];
      let timed = false;
      let all = '';
      for (const ev of data.events || []) {
        if (!ev.segs) continue;
        const t0 = ev.tStartMs || 0;
        if (ev.segs.some((s) => s.tOffsetMs != null)) {
          timed = true;
          for (const s of ev.segs) {
            const c = letters(s.utf8);
            if (c) { words.push({ t: t0 + (s.tOffsetMs || 0), c }); all += s.utf8; }
          }
        } else {
          const line = ev.segs.map((s) => s.utf8).join('');
          const ws = clean(line).split(/\s+/).filter((w) => letters(w));
          const d = ev.dDurationMs || 2000;
          ws.forEach((w, i) => words.push({ t: t0 + (d * i) / ws.length, c: letters(w) }));
          all += line;
        }
      }
      words.sort((a, b) => a.t - b.t);
      return { words, timed, dense: (all.match(DENSE) || []).length > 0.3 * (all.match(LETTERS) || []).length };
    }

    function lowerBound(words, t) {
      let lo = 0, hi = words.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (words[m].t < t) lo = m + 1; else hi = m; }
      return lo;
    }

    // Spoken characters per second around media time t (ms), pauses excluded.
    function cpsAt(words, t) {
      const i0 = lowerBound(words, t - LOOKBEHIND_MS);
      const i1 = lowerBound(words, t + LOOKAHEAD_MS);
      if (i1 - i0 < 6) return null;
      let chars = 0, speaking = 300;
      for (let k = i0; k < i1; k++) {
        chars += words[k].c;
        if (k + 1 < i1) speaking += Math.min(words[k + 1].t - words[k].t, 700);
      }
      return chars / (speaking / 1000);
    }

    function accept(videoId, text) {
      if (!videoId || !text) return;
      let parsed;
      try { parsed = parse(text); } catch { return; }
      if (parsed.words.length < 20) return;
      const prev = store.get(videoId);
      if (prev && prev.timed && !parsed.timed) return; // keep word-timed track
      const samples = [];
      const end = parsed.words[parsed.words.length - 1].t;
      for (let t = 0; t <= end; t += 2000) {
        const c = cpsAt(parsed.words, t);
        if (c) samples.push(c);
      }
      const videoCps = median(samples);
      if (!videoCps) return;
      // Cross-video normalisation (fast talkers slightly slower, slow ones faster).
      const scriptFactor = parsed.dense ? 1 : clamp(Math.pow(REF_CPS / videoCps, 0.5), 0.87, 1.15);
      store.set(videoId, { words: parsed.words, timed: parsed.timed, videoCps, scriptFactor });
      missing.delete(videoId);
    }

    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.__tempo !== 'page') return;
      const d = e.data;
      if (d.type === 'timedtext') {
        let id = d.videoId;
        try { id = id || new URL(d.url, location.origin).searchParams.get('v'); } catch {}
        accept(id, d.text);
      } else if (d.type === 'captions-missing' && d.videoId) {
        if (!store.has(d.videoId)) missing.set(d.videoId, d.reason);
      } else if (d.type === 'captions-missing' && d.reason === 'not-ready') {
        const id = currentVideoId();
        if (id) requested.delete(id); // try again on a later tick
      }
    });

    function request() {
      if (!settings.enabled || !settings.smartSpeed) return;
      const id = currentVideoId();
      if (!id || store.has(id) || requested.has(id)) return;
      requested.add(id);
      setTimeout(() => window.postMessage({ __tempo: 'content', type: 'fetch-captions' }, location.origin), 800);
    }

    // Smart speed multiplier at media time t (ms), or null if unknown.
    function factorAt(t) {
      const entry = store.get(currentVideoId());
      if (!entry) return null;
      const local = cpsAt(entry.words, t);
      if (!local) return entry.scriptFactor;
      const within = clamp(Math.pow(entry.videoCps / local, 0.7), 0.8, 1.25);
      return clamp(within * entry.scriptFactor, SMART_MIN, SMART_MAX);
    }

    return {
      request,
      factorAt,
      has: () => store.has(currentVideoId()),
      missingReason: () => missing.get(currentVideoId()) || null,
    };
  })();

  // ===========================================================================
  // Audio analysis: silence detection and syllable rate
  //
  // Audio is read from video.captureStream(), so the page's own audio path is
  // never touched. Levels are tracked adaptively: a slow-rising noise floor and
  // a slow-decaying speech level, with the threshold placed between them.
  // ===========================================================================

  let savedVideo = 0;
  let savedSession = 0;

  // ===========================================================================
  // Watch statistics: media time watched vs. real time spent on this video
  // ===========================================================================

  const watch = (() => {
    let media = 0;     // seconds of video content covered (played + skipped)
    let real = 0;      // seconds of real time it took
    let rate = NORMAL; // smoothed effective speed (~last minute), incl. silence skipping
    let lastAt = 0;
    let lastPos = null;

    function sample() {
      const now = performance.now();
      const dt = (now - lastAt) / 1000;
      lastAt = now;
      const v = getVideo();
      if (v && !v.paused && !v.ended && !isAd() && dt <= 5) {
        const pos = v.currentTime;
        if (lastPos !== null) {
          const dm = pos - lastPos;
          if (dm > 0 && dm <= dt * 16 + 0.3) {
            media += dm;
            real += dt;
            rate += (dm / dt - rate) * Math.min(1, dt / 60);
          }
        }
        lastPos = pos;
      } else {
        lastPos = v ? v.currentTime : null;
      }
      remaining.update();
    }

    function resetRate() { rate = userBase() * smartFactor; }
    function reset() { media = 0; real = 0; lastPos = null; resetRate(); }
    function addSkipped(sec) { media = Math.max(0, media + sec); }

    lastAt = performance.now();
    setInterval(sample, 500);
    document.addEventListener('seeking', (e) => { if (e.target === getVideo()) lastPos = null; }, true);

    return { reset, resetRate, addSkipped, media: () => media, real: () => real, rate: () => rate };
  })();

  // ===========================================================================
  // Sponsor & intro skipping (SponsorBlock community data)
  //
  // The lookup uses SponsorBlock's privacy-preserving API: only the first four
  // characters of the video ID's SHA-256 hash leave the browser.
  // ===========================================================================

  const segments = (() => {
    const cache = new Map(); // videoId -> [{ start, end, category, undone }]
    const pending = new Set();
    let timer = 0;

    function list() {
      return settings.enabled && settings.skipSegments ? cache.get(currentVideoId()) || [] : [];
    }

    function request() {
      if (!settings.enabled || !settings.skipSegments) return;
      const id = currentVideoId();
      if (!id || cache.has(id) || pending.has(id)) return;
      pending.add(id);
      try {
        chrome.runtime.sendMessage({ type: 'segments', videoId: id }, (res) => {
          pending.delete(id);
          if (chrome.runtime.lastError || !res || !res.ok) return;
          cache.set(id, res.segments.map((s) => ({ ...s, undone: false })).sort((a, b) => a.start - b.start));
        });
      } catch { pending.delete(id); }
    }

    function check() {
      const v = getVideo();
      if (!v || v.paused || isAd()) return;
      const t = v.currentTime;
      for (const s of list()) {
        if (s.undone || t < s.start || t >= s.end - 0.3) continue;
        const to = Math.min(s.end, (v.duration || s.end) - 0.1);
        if (to <= t) continue;
        v.currentTime = to;
        watch.addSkipped(to - t);
        const label = msg(`skipped_${s.category}`);
        snackbar.show(label.startsWith('skipped_') ? msg('skipped_sponsor') : label, () => {
          s.undone = true;
          v.currentTime = s.start;
          watch.addSkipped(-(to - t));
        });
        break;
      }
    }

    // Seconds of upcoming segment content after time t.
    function upcoming(t) {
      let sum = 0;
      for (const s of list()) if (!s.undone && s.end > t) sum += s.end - Math.max(s.start, t);
      return sum;
    }

    function update() {
      const want = settings.enabled && settings.skipSegments;
      if (want) request();
      if (want && !timer) timer = setInterval(check, 100);
      else if (!want && timer) { clearInterval(timer); timer = 0; }
    }

    return { update, request, upcoming };
  })();

  // ===========================================================================
  // Snackbar (Material-style, with Undo)
  // ===========================================================================

  const snackbar = (() => {
    let el = null;
    let hideTimer = 0;
    let undoFn = null;

    function build(player) {
      el = document.createElement('div');
      el.className = 'tempo-snackbar';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      const text = document.createElement('span');
      text.className = 'tempo-snackbar__text';
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'tempo-snackbar__action';
      action.textContent = msg('undo');
      // Keep clicks from reaching the player (which would toggle playback).
      for (const ev of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick']) {
        el.addEventListener(ev, (e) => e.stopPropagation());
      }
      action.addEventListener('click', () => {
        const fn = undoFn;
        hide();
        if (fn) fn();
      });
      el.append(text, action);
      player.appendChild(el);
    }

    function show(text, onUndo) {
      const player = getPlayer();
      if (!player) return;
      if (!el || !player.contains(el)) build(player);
      el.querySelector('.tempo-snackbar__text').textContent = text;
      undoFn = onUndo;
      el.classList.add('tempo-snackbar--visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 5000);
    }

    function hide() {
      undoFn = null;
      if (el) el.classList.remove('tempo-snackbar--visible');
    }

    return { show, hide };
  })();

  // ===========================================================================
  // Remaining time, shown inline next to YouTube's own time display
  // ===========================================================================

  const remaining = (() => {
    let el = null;

    function clock(sec) {
      const s = Math.max(0, Math.round(sec));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = String(s % 60).padStart(2, '0');
      return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
    }

    function hide() { if (el) el.hidden = true; }

    function update() {
      const v = getVideo();
      const duration = getPlayer()?.querySelector('.ytp-time-duration');
      if (!settings.enabled || !settings.remaining || !v || !duration || isAd() ||
          !Number.isFinite(v.duration) || v.duration <= 0) return hide();

      const t = v.currentTime;
      const skip = segments.upcoming(t);
      const rate = v.paused ? userBase() * smartFactor : watch.rate();
      // Only worth showing when Tempo actually changes the remaining time.
      if (Math.abs(rate - 1) < 0.02 && skip < 1) return hide();

      if (!el || !el.isConnected || el.previousElementSibling !== duration) {
        el?.remove();
        el = document.createElement('span');
        el.className = 'tempo-remaining';
        el.title = msg('remainingTooltip');
        duration.after(el);
      }
      el.hidden = false;
      el.textContent = msg('remaining', [clock((v.duration - t - skip) / Math.max(rate, 0.1))]);
    }

    return { update };
  })();

  const detector = (() => {
    let ctx = null, analyser = null, buf = null;
    let source = null, stream = null, capturedVideo = null;
    let available = true;

    let floor = -60, peak = -20;
    let quietMs = 0, warmMs = 0, coolUntil = 0;

    // Syllable tracking (media time).
    let clock = 0, prevDb = -100, prevPrevDb = -100, minSincePeak = -100, lastPeakAt = -1e9;
    let peaks = [], speech = [], rateHistory = [], lastRateAt = 0;

    function reset() {
      floor = -60; peak = -20; quietMs = 0; warmMs = 0;
      clock = 0; prevDb = prevPrevDb = minSincePeak = -100; lastPeakAt = -1e9;
      peaks = []; speech = []; rateHistory = []; lastRateAt = 0;
    }

    function cooldown(ms = 1500) {
      quietMs = 0;
      coolUntil = performance.now() + ms;
    }

    function disconnect() {
      try { source?.disconnect(); } catch {}
      source = stream = capturedVideo = null;
    }

    function ensureCapture(v) {
      if (!available) return false;
      if (!ctx) {
        try {
          ctx = new AudioContext();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          buf = new Float32Array(analyser.fftSize);
          const sink = ctx.createGain();
          sink.gain.value = 0; // keep the graph pulling without producing sound
          analyser.connect(sink).connect(ctx.destination);
        } catch {
          ctx = null;
          available = false;
          return false;
        }
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const live = stream && stream.getAudioTracks().some((t) => t.readyState === 'live');
      if (capturedVideo === v && live) return ctx.state === 'running';

      disconnect();
      try {
        const s = v.captureStream();
        if (!s.getAudioTracks().length) return false; // not ready yet
        stream = s;
        source = ctx.createMediaStreamSource(s);
        source.connect(analyser);
        capturedVideo = v;
        available = true;
        return ctx.state === 'running';
      } catch {
        available = false;
        return false;
      }
    }

    function levelDb() {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      return rms > 0 ? 20 * Math.log10(rms) : -100;
    }

    // Count syllable nuclei: local level peaks with enough prominence.
    function trackSyllables(db, threshold, mediaDt) {
      clock += mediaDt;
      const speaking = db > threshold;
      speech.push({ t: clock, d: speaking ? mediaDt : 0 });
      minSincePeak = Math.min(minSincePeak, db);
      if (prevDb > prevPrevDb && prevDb >= db && prevDb > threshold + 3 &&
          prevDb - minSincePeak >= 3 && clock - lastPeakAt >= 110) {
        peaks.push(clock - mediaDt);
        lastPeakAt = clock - mediaDt;
        minSincePeak = prevDb;
      }
      prevPrevDb = prevDb;
      prevDb = db;

      const from = clock - 6000;
      while (peaks.length && peaks[0] < from) peaks.shift();
      while (speech.length && speech[0].t < from) speech.shift();

      if (clock - lastRateAt >= 1000) {
        lastRateAt = clock;
        const speakingSec = speech.reduce((a, s) => a + s.d, 0) / 1000;
        if (speakingSec >= 2) {
          rateHistory.push(peaks.length / speakingSec);
          if (rateHistory.length > 180) rateHistory.shift();
        }
      }
    }

    function audioFactor() {
      if (rateHistory.length < 8) return null;
      const now = rateHistory[rateHistory.length - 1];
      const typical = median(rateHistory);
      if (!now || !typical) return null;
      return clamp(Math.pow(typical / now, 0.6), 0.8, 1.25);
    }

    // Returns false when audio could not be analysed this tick.
    function tick(v, dt, now) {
      if (v.muted || v.volume === 0) return false;
      if (!ensureCapture(v)) return false;

      const db = levelDb();
      if (db < floor) floor += (db - floor) * 0.25;
      else floor += (db - floor) * 0.002;
      if (db > peak) peak += (db - peak) * 0.3;
      else peak = Math.max(floor + 10, peak - 0.015 * (dt / TICK_MS));

      warmMs += dt;
      if (warmMs < WARMUP_MS) return true;

      const cfg = silenceProfile();
      const threshold = Math.min(peak - 6, floor + Math.max(MIN_GAP_DB, (peak - floor) * cfg.ratio));
      const mediaDt = dt * (v.playbackRate || 1);

      // Syllable rate is only reliable while a tick spans < ~65 ms of media.
      if (settings.smartSpeed && !skipping && v.playbackRate <= 2.6) trackSyllables(db, threshold, mediaDt);

      // Never fast-forward into the end of a video (autoplay starts the next one).
      const nearEnd = Number.isFinite(v.duration) && v.duration - v.currentTime < 1.5;
      if (!settings.silenceSkip || now < coolUntil || nearEnd) { if (skipping) stopSkip(); return true; }

      if (skipping) {
        if (db > threshold - EXIT_BIAS_DB) {
          stopSkip();
          quietMs = 0;
        } else {
          const saved = (dt / 1000) * (skipSpeed() / (userBase() * smartFactor) - 1);
          savedVideo += saved;
          savedSession += saved;
        }
      } else if (db < threshold) {
        quietMs += mediaDt;
        if (quietMs >= cfg.minSilence) startSkip();
      } else {
        quietMs = 0;
      }
      return true;
    }

    function suspend() {
      disconnect();
      if (ctx) ctx.suspend().catch(() => {});
    }

    function resume() {
      if (ctx && ctx.state === 'suspended' && loop.running()) ctx.resume().catch(() => {});
    }

    return { tick, reset, cooldown, suspend, resume, audioFactor, isAvailable: () => available };
  })();

  // ===========================================================================
  // Smart speed
  // ===========================================================================

  const smart = (() => {
    let target = 1;
    let source = 'off'; // off | captions | audio | waiting
    let coolUntil = 0;
    let sinceUpdate = 0;

    function reset() { target = 1; sinceUpdate = 0; }
    function cooldown(ms = 1500) { coolUntil = performance.now() + ms; }

    function tick(v, dt, now, audioOk) {
      if (!settings.smartSpeed) {
        source = 'off';
        if (smartFactor !== 1) { smartFactor = 1; target = 1; sync(); }
        return;
      }
      captions.request();

      sinceUpdate += dt;
      if (sinceUpdate >= 250) {
        sinceUpdate = 0;
        let next = captions.factorAt(v.currentTime * 1000);
        if (next !== null) source = 'captions';
        else {
          next = audioOk ? detector.audioFactor() : null;
          source = next !== null ? 'audio' : 'waiting';
        }
        if (next !== null && now >= coolUntil) target = next;
      }

      // Smoothly move toward the target.
      let f = smartFactor + (target - smartFactor) * Math.min(1, dt / SMART_SMOOTH_MS);
      if (Math.abs(f - 1) < 0.01 && Math.abs(target - 1) < 0.01) f = 1;
      smartFactor = f;
      if (skipping) return;
      const want = managing() ? targetRate() : null;
      const changed = want === null || expected === null ? want !== expected : !same(want, expected);
      if (changed) sync();
    }

    return { tick, reset, cooldown, source: () => source, target: () => target };
  })();

  // ===========================================================================
  // Main loop (runs only while silence skipping or smart speed is enabled)
  // ===========================================================================

  const loop = (() => {
    let timer = 0;
    let last = 0;

    function tick() {
      const now = performance.now();
      const dt = now - last;
      last = now;

      const v = getVideo();
      if (!settings.enabled || !v || v.paused || v.ended || isAd()) { stopSkip(); return; }
      // Timer was throttled (e.g. hidden tab): never keep fast-forwarding blind.
      if (dt > 250) { stopSkip(); return; }

      const audioOk = detector.tick(v, dt, now);
      if (!audioOk) stopSkip();
      smart.tick(v, dt, now, audioOk);
    }

    function update() {
      const want = settings.enabled && (settings.silenceSkip || settings.smartSpeed);
      if (want && !timer) {
        last = performance.now();
        timer = setInterval(tick, TICK_MS);
        captions.request();
      } else if (!want && timer) {
        clearInterval(timer);
        timer = 0;
        stopSkip();
        if (smartFactor !== 1) { smartFactor = 1; sync(); }
        detector.suspend();
      }
      if (!settings.silenceSkip) stopSkip();
      if (!settings.smartSpeed && smartFactor !== 1) { smartFactor = 1; smart.reset(); sync(); }
    }

    return { update, running: () => !!timer };
  })();

  // AudioContext needs a user gesture on some pages; resume on interaction.
  for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, () => detector.resume(), true);

  // ===========================================================================
  // Settings
  // ===========================================================================

  try {
    chrome.storage.sync.get(settings, (stored) => {
      for (const k of Object.keys(settings)) if (k in stored) settings[k] = stored[k];
      if (!settings.enabled) release();
      loop.update();
      segments.update();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const [k, { newValue }] of Object.entries(changes)) {
        if (k in settings) settings[k] = newValue;
      }
      if (!settings.enabled) release();
      if (skipping) sync(); // skip speed may have changed
      loop.update();
      segments.update();
      remaining.update();
    });
  } catch { /* extension context invalidated */ }

  // ===========================================================================
  // Overlay & skip badge
  // ===========================================================================

  let overlay = null;
  let overlayTimer = 0;
  let badge = null;

  function buildOverlay(player) {
    overlay = document.createElement('div');
    overlay.className = 'tempo-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    for (const part of ['value', 'label', 'track']) {
      const el = document.createElement('div');
      el.className = `tempo-overlay__${part}`;
      overlay.appendChild(el);
    }
    const fill = document.createElement('div');
    fill.className = 'tempo-overlay__fill';
    overlay.querySelector('.tempo-overlay__track').appendChild(fill);
    player.appendChild(overlay);
  }

  function showOverlay(s) {
    if (!settings.overlay) return;
    const player = getPlayer();
    if (!player) return;
    if (!overlay || !player.contains(overlay)) buildOverlay(player);
    overlay.querySelector('.tempo-overlay__value').textContent = format(s);
    overlay.querySelector('.tempo-overlay__label').textContent =
      same(s, NORMAL) ? msg('normal') : msg('playbackSpeed');
    const i = STEPS.findIndex((x) => same(x, s));
    overlay.querySelector('.tempo-overlay__fill').style.width = `${((i + 1) / STEPS.length) * 100}%`;
    overlay.classList.add('tempo-overlay--visible');
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => overlay.classList.remove('tempo-overlay--visible'), 1100);
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function buildBadge(player) {
    badge = document.createElement('div');
    badge.className = 'tempo-skip';
    badge.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z');
    svg.appendChild(path);
    const label = document.createElement('span');
    label.className = 'tempo-skip__label';
    badge.append(svg, label);
    player.appendChild(badge);
  }

  function showSkipBadge(on) {
    const player = getPlayer();
    if (!player) return;
    if (!badge || !player.contains(badge)) buildBadge(player);
    if (on && settings.overlay) {
      badge.querySelector('.tempo-skip__label').textContent = format(skipSpeed());
      badge.classList.add('tempo-skip--visible');
    } else {
      badge.classList.remove('tempo-skip--visible');
    }
  }

  // ===========================================================================
  // Keyboard
  // ===========================================================================

  const isEditable = (el) =>
    !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  window.addEventListener('keydown', (e) => {
    if (!settings.enabled) return;
    if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (isEditable(document.activeElement) || !getVideo()) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // keep YouTube's volume shortcut from firing
    step(e.key === 'ArrowUp' ? 1 : -1);
  }, true);

  // ===========================================================================
  // Popup bridge
  // ===========================================================================

  try {
    chrome.runtime.onMessage.addListener((req, _sender, reply) => {
      if (!req || typeof req.type !== 'string') return;
      const v = getVideo();
      if (v && settings.enabled) {
        if (req.type === 'step') step(req.dir > 0 ? 1 : -1);
        else if (req.type === 'reset') setSpeed(NORMAL);
      }
      reply({
        hasVideo: !!v,
        speed: locked === null ? NORMAL : locked,
        locked: locked !== null,
        min: STEPS[0],
        max: STEPS[STEPS.length - 1],
        playbackRate: v ? v.playbackRate : NORMAL,
        skipping,
        silenceAvailable: detector.isAvailable(),
        savedVideo,
        savedSession,
        watchedMedia: watch.media(),
        watchedReal: watch.real(),
        smartSource: smart.source(),
        captionsMissing: captions.missingReason(),
      });
    });
  } catch { /* extension context invalidated */ }
})();
