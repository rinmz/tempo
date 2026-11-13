# Tempo

Chrome extension for controlling YouTube playback speed, and for seeing how much time it saves you.

## Features

- **Keyboard speed:** `Shift + ↑` jumps to 2×, then adds 0.25× per press up to 10×. `Shift + ↓` slows down. Speed persists across videos.
- **Skip sponsors:** jumps over sponsor segments and intros using the SponsorBlock database, with one-tap undo.
- **Time remaining:** shows what is left at your current speed.
- **Time saved:** per-video stats compared to constant 2×.
- **Skip silence** and **smart speed** (adapts to how fast people talk).
- English and Turkish.

## Privacy

No accounts, analytics or tracking. Audio and captions are processed on your device. See `privacy/privacy.html`.

## Install from source

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.

Requires Chrome 111 or newer.

## Build

`store/package.ps1` creates the zip for the Chrome Web Store. Listing text is in `store/LISTING.md`.

## Credits

Sponsor data from [SponsorBlock](https://sponsor.ajay.app), CC BY-NC-SA 4.0. Not affiliated with YouTube or Google.
