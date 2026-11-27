# Frost web editor — fork with model-conversion cache

Changes over the upstream `web/`:
1. `model_cache.js` (new): IndexedDB cache keyed by SHA-256 of the `.nam` JSON + model name.
2. `app.js`:
   - converts once, then re-uses the cached `.fcm` record on the next click (instant);
   - worker count now uses `navigator.hardwareConcurrency` (cap 8) instead of a fixed 4;
   - cache hits/misses reported by toast.
3. `index.html`: cache-busting version bumped to `app.js?v=1.10.0`.

## Run locally
```sh
cd frost-web-fork
python3 -m http.server 8123
# open http://localhost:8123/
```
Chrome/Edge recommended (Web MIDI + IndexedDB + module workers).

## Notes
- `.fcm` files still load instantly (no conversion); the cache only helps repeated `.nam` conversions.
- Clear the cache in DevTools → Application → IndexedDB → `frost-model-cache`.
- This fork is only the editor; it does not change the firmware image.
## Batch conversion (v1.10 fork addition)
- In **NAMS & IRS → Add model** there is now a **Batch...** button: pick several `.nam`/`.fcm` at once.
- Files are converted **one at a time** (avoids CPU thrash); progress shows `i/n file.name`.
- Results: **Download all .fcm** and **Write all to free slots** (asks confirmation and only uses empty model slots).
- Converted records are cached (IndexedDB), so a repeat batch of the same captures is instant.
- Cancel stops the queue after the current item.
