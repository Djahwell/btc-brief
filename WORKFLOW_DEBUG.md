# GitHub Actions Workflow Debug Report

## Summary
The `data-refresh.yml` workflow stopped successfully deploying to gh-pages after April 26, 2026. The last successful deploy was 20 days ago.

## Root Cause Analysis

### What Happened
1. **April 26**: Workflow running successfully, deploying data every 6 hours
2. **May 1**: Regulatory news integration added to data-worker.js
3. **May 3**: Multiple commits attempting to fix NEWS_API_KEY secret passing
4. **May 3 - Present**: Workflow running but NOT deploying (silent failure)

### Why It Stopped
The workflow is likely failing at one of these points:

1. **Playwright Chromium Installation Failure** (most likely)
   - The `npx playwright install chromium --with-deps` step could be timing out or failing on GitHub Actions
   - This would break the LTH data fetching (Farside and Bitcoin Magazine Pro scrapers)
   - Data-worker might exit with non-zero code, causing deploy to skip

2. **Missing NEWS_API_KEY Secret**
   - The code gracefully handles this (returns empty array)
   - But GitHub might be failing to pass secrets correctly
   - Look for empty VITE_NEWS_API_KEY in logs

3. **Deploy Action Failure**
   - JamesIves/github-pages-deploy-action might be failing silently
   - Workflow shows "success" but deploy doesn't happen

## Fixes Applied

### ✅ Error Handling Improvements
- Added `set -e` to fail fast on errors
- Added explicit checks after data-worker.js runs
- Added file verification before deploy step
- Added explicit GITHUB_TOKEN to deploy action

### ✅ Better Logging
- Added "DEBUG:" output for environment variables
- Added verification of all_data.json creation
- Added Playwright installation status check
- Added file listing before deploy

## Next Steps

### Option 1: Manual Trigger (Recommended)
1. Go to: https://github.com/Djahwell/btc-brief/actions
2. Select "Refresh All Data Cache (no Claude call)" workflow
3. Click "Run workflow" button
4. Check the logs to see what fails

**Expected output in logs:**
```
DEBUG: Environment variables:
VITE_DUNE_API_KEY=sbyfrdhIXMQCkWzExmbD4Rea3U7vcbc7
VITE_NEWS_API_KEY=<empty or set>

Running data-worker.js...
[Worker] data-worker v3.0.0 run started...
...
[Worker] ✓ Cache written → public/all_data.json
...
```

### Option 2: Configure NEWS_API_KEY Secret (Optional but recommended)
1. Sign up for free at https://newsapi.org/
2. Get your API key
3. Go to GitHub repo Settings → Secrets and variables → Actions
4. Add secret: `VITE_NEWS_API_KEY` = your key
5. This enables regulatory news fetching in the brief

### Option 3: Monitor Next Scheduled Run
The workflow should run automatically at:
- **Next UTC times**: 00:00, 06:00, 12:00, 18:00
- Check the Actions tab for run results
- Review logs if it still fails

## Files Modified
- `.github/workflows/data-refresh.yml` - Added error checking and logging

## Testing the Fix
```bash
# Test locally
npm run data

# Check if all_data.json was created
ls -lh public/all_data.json

# Verify structure
head -c 500 public/all_data.json
```

## Monitoring
After fixes are deployed, watch for:
1. Next scheduled run (check Actions tab)
2. Successful deploy to gh-pages (should see new commits)
3. Fresh data in the brief (cachedAt should be current)

If the workflow still fails after 1-2 scheduled runs (12 hours), check GitHub Actions logs for specific error messages.
