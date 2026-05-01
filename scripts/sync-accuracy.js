#!/usr/bin/env node

/**
 * Sync accuracy history from local cache to accuracy-history.json
 * Called by GitHub Actions daily or manually via: npm run sync-accuracy
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ACCURACY_HISTORY_PATH = path.join(__dirname, '../accuracy-history.json');
const ACCURACY_CACHE_PATH = path.join(__dirname, '../public/accuracy-cache.json');

async function syncAccuracy() {
  console.log('[Sync] Starting accuracy history sync...');

  try {
    // Load existing accuracy history
    let history = { metadata: { lastUpdated: new Date().toISOString(), totalGraded: 0 }, entries: [] };
    if (fs.existsSync(ACCURACY_HISTORY_PATH)) {
      const existing = fs.readFileSync(ACCURACY_HISTORY_PATH, 'utf8');
      history = JSON.parse(existing);
    }

    // Check for cached accuracy updates (written by the app)
    let newEntries = [];
    if (fs.existsSync(ACCURACY_CACHE_PATH)) {
      try {
        const cached = JSON.parse(fs.readFileSync(ACCURACY_CACHE_PATH, 'utf8'));
        newEntries = cached.entries || [];
        console.log(`[Sync] Found ${newEntries.length} entries in cache`);
      } catch (e) {
        console.warn('[Sync] Could not parse accuracy cache:', e.message);
      }
    }

    // Merge new entries with history (deduplicate by date + price combo)
    const existingDates = new Set(history.entries.map(e => e.date));
    let addedCount = 0;

    for (const entry of newEntries) {
      // Check if this entry already exists
      const exists = history.entries.some(
        e => e.date === entry.date && e.price === entry.price
      );

      if (!exists && entry.outcome) {
        history.entries.push(entry);
        addedCount++;
      }
    }

    // Count graded entries (exclude FLAT for hit rate calc)
    const graded = history.entries.filter(e => e.outcome && e.outcome !== 'FLAT');
    history.metadata.totalGraded = graded.length;
    history.metadata.lastUpdated = new Date().toISOString();

    // Write updated history
    fs.writeFileSync(ACCURACY_HISTORY_PATH, JSON.stringify(history, null, 2));
    console.log(`[Sync] ✓ Synced ${addedCount} new entries. Total graded: ${graded.length}`);

    // Clear the cache file after syncing
    if (fs.existsSync(ACCURACY_CACHE_PATH)) {
      fs.unlinkSync(ACCURACY_CACHE_PATH);
      console.log('[Sync] Cleared accuracy cache');
    }

  } catch (error) {
    console.error('[Sync] Error during sync:', error);
    process.exit(1);
  }
}

(async () => {
  await syncAccuracy();
})();
