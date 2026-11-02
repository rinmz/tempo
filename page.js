// Runs in the page's main world. Its only job is to hand caption data
// (timed text) to Tempo's content script; it never modifies the page.
(() => {
  'use strict';
  if (window.__tempoPage) return;
  window.__tempoPage = true;

  const post = (data) => window.postMessage({ __tempo: 'page', ...data }, location.origin);
  const isTimedText = (url) => typeof url === 'string' && url.includes('/api/timedtext');
  const nativeFetch = window.fetch;

  // Captions the player loads itself (e.g. when the user turns on CC).
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const result = nativeFetch.apply(this, arguments);
    if (isTimedText(url)) {
      result.then((r) => r.clone().text()).then((text) => post({ type: 'timedtext', url, text })).catch(() => {});
    }
    return result;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__tempoUrl = String(url);
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (isTimedText(this.__tempoUrl)) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') {
            post({ type: 'timedtext', url: this.__tempoUrl, text: this.responseText });
          }
        } catch {}
      });
    }
    return send.apply(this, arguments);
  };

  // On request, fetch the best caption track of the current video directly.
  async function fetchCaptions() {
    const player = document.getElementById('movie_player');
    const response = player && player.getPlayerResponse && player.getPlayerResponse();
    const videoId = response && response.videoDetails && response.videoDetails.videoId;
    const tracks =
      (response && response.captions &&
        response.captions.playerCaptionsTracklistRenderer &&
        response.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
    if (!videoId) return post({ type: 'captions-missing', reason: 'not-ready' });
    if (!tracks.length) return post({ type: 'captions-missing', videoId, reason: 'none' });

    // Auto-generated tracks carry per-word timing, which is what we want.
    const track = tracks.find((t) => t.kind === 'asr') || tracks[0];
    try {
      const url = new URL(track.baseUrl, location.origin);
      url.searchParams.set('fmt', 'json3');
      const res = await nativeFetch(url.toString(), { credentials: 'include' });
      const text = await res.text();
      if (text && text.trim()) post({ type: 'timedtext', url: url.toString(), text, videoId });
      else post({ type: 'captions-missing', videoId, reason: 'blocked' });
    } catch {
      post({ type: 'captions-missing', videoId, reason: 'blocked' });
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tempo !== 'content') return;
    if (e.data.type === 'fetch-captions') fetchCaptions();
    if (e.data.type === 'set-rate') {
      const rate = Number(e.data.rate);
      const player = document.getElementById('movie_player');
      if (player && player.setPlaybackRate && rate >= 0.25 && rate <= 16) {
        try { player.setPlaybackRate(rate); } catch {}
      }
    }
  });
})();
