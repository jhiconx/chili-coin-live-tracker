# Chili Coin Live Tracker — V22 Base Rebuild

This replacement rebuilds the Base logic from scratch.

## What changed

- Base no longer uses BaseScan page scraping.
- Base no longer uses Blockscout holder counters.
- Base holders are computed from the complete Base CHI ERC-20 Transfer history.
- Base TXN is counted from the same complete Transfer history.
- Base latest rows come from the same Transfer history.
- If Base fails, the API leaves Base blank instead of replacing it with `0` or a wrong fallback value.

## Upload

Upload every file/folder in this replacement folder to the top level of the GitHub repository, including the full `api` folder.

Commit message:

`Rebuild Base from Transfer history`

After Vercel redeploys, open:

`https://chili-coin-live-tracker.vercel.app/api/live?force=1`

Search for:

`v22-base-rebuilt-from-transfer-history`
