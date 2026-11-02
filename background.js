'use strict';

// Looks up sponsor/intro segments from SponsorBlock.
// Privacy: only the first 4 hex characters of SHA-256(videoId) are sent;
// the matching video is picked locally from the returned list.

const API = 'https://sponsor.ajay.app/api/skipSegments';
const CATEGORIES = ['sponsor', 'selfpromo', 'interaction', 'intro'];

async function sha256Hex(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchSegments(videoId) {
  const prefix = (await sha256Hex(videoId)).slice(0, 4);
  const params = new URLSearchParams({
    categories: JSON.stringify(CATEGORIES),
    actionTypes: JSON.stringify(['skip']),
  });
  const res = await fetch(`${API}/${prefix}?${params}`);
  if (res.status === 404) return { ok: true, segments: [] }; // no segments for this prefix
  if (!res.ok) return { ok: false };
  const data = await res.json();
  const entry = Array.isArray(data) ? data.find((d) => d.videoID === videoId) : null;
  const segments = (entry?.segments || [])
    .filter((s) => Array.isArray(s.segment) && s.segment[1] > s.segment[0])
    .map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category }));
  return { ok: true, segments };
}

// Show the welcome page once, right after installation.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
  }
});

chrome.runtime.onMessage.addListener((req, _sender, reply) => {
  if (!req || req.type !== 'segments' || !/^[\w-]{11}$/.test(req.videoId)) return;
  chrome.permissions.contains({ origins: ['https://sponsor.ajay.app/*'] }, (granted) => {
    if (!granted) return reply({ ok: false, reason: 'permission' });
    fetchSegments(req.videoId).then(reply, () => reply({ ok: false }));
  });
  return true; // async reply
});
