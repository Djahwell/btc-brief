# Accuracy History Sync

Your BTC Brief accuracy history now persists in the repository, synced automatically daily.

## How It Works

1. **App tracks accuracy locally** — Stores in browser localStorage
2. **You export when ready** — Click "EXPORT" button in TEST GRADING panel
3. **Daily auto-sync** — GitHub Actions runs daily to merge new entries
4. **History stays forever** — Never lost, syncs across devices

## Workflow

### Manual Sync (Quick way):

```bash
# 1. Export your accuracy log from the app (click EXPORT button)
# 2. This downloads accuracy-export-YYYY-MM-DD.json

# 3. Move the file to public/ folder:
cp accuracy-export-2026-05-01.json public/accuracy-cache.json

# 4. Run sync:
npm run sync-accuracy

# 5. Commit and push:
git add accuracy-history.json
git commit -m "chore: sync accuracy history"
git push
```

### Automatic Sync (Every night):

GitHub Actions runs daily at **3 AM UTC** and:
- Checks for new accuracy entries
- Merges with accuracy-history.json  
- Commits if there are changes
- Re-deploys brief with updated history

## What Gets Synced

Each graded entry includes:
```json
{
  "date": "2026-05-01",
  "price": 62500,
  "score": +3,
  "bias": "BULLISH",
  "recommendation": "ACCUMULATE",
  "outcome": "CORRECT",
  "pctMove": "2.5%"
}
```

## Check Sync Status

View your accuracy history anytime:
```bash
cat accuracy-history.json
```

Shows total graded calls, hit rate, and full call log.

## How Claude Uses It

When generating a new brief, Claude receives:
- Last 7 graded calls
- Hit rate (from all graded calls)
- Bias drift analysis
- Self-calibration feedback

Example feedback Claude gets:
```
YOUR RECENT CALL PERFORMANCE (last 7 graded calls):
  Hit rate: 65% (5/7 correct | 2 flat)
  Avg score on CORRECT calls: +2.3 | Avg score on WRONG calls: -1.0
  Bias drift: BALANCED ERRORS
  High-conviction calls (score >=5 or <=-5) hit rate: 70%
```

Claude then adjusts reasoning based on this performance data.

## Testing the Sync

Test with the TEST GRADING panel:

1. Switch to TEST MODE
2. Inject 40% or 70% hit rate
3. Click EXPORT (saves accuracy-export-*.json)
4. Run `npm run sync-accuracy`
5. Check: `cat accuracy-history.json`
6. See the entries merged into the persistent history

## Timezone Note

The workflow runs daily at **3 AM UTC**. To change the time, edit `.github/workflows/sync-accuracy.yml`:

```yaml
- cron: '0 3 * * *'  # Change 3 to your preferred hour
```

## Troubleshooting

**Sync not working?**
- Make sure accuracy-cache.json exists in `public/` folder
- Check GitHub Actions logs: Settings → Actions → Daily Accuracy Sync

**File permissions error?**
- Ensure your GitHub token has repo write access
- The workflow uses `secrets.GITHUB_TOKEN` (auto-created)

**Want to reset history?**
```bash
# Clear all entries (keep metadata):
echo '{"metadata":{"lastUpdated":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","totalGraded":0},"entries":[]}' > accuracy-history.json
```
