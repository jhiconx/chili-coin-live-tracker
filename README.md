V23 TXN-only reset: this is the V23 codebase with only the TXN total changed to equal BaseScan Transfers + Etherscan Transfers.

# Chili Coin Live Tracker — V23 Base Reset

Full GitHub-ready code for the Chili Coin tracker.

## Upload

Upload all files and folders in this directory to the root of the GitHub repo:

- `index.html`
- `styles.css`
- `app.js`
- `api/`
- `assets/`
- `README.md`
- `SOURCE_NOTES.md`

## Vercel

Environment variable name:

```text
ETHERSCAN_API_KEY
```

This version has a separate `/api/base` endpoint and keeps last-good Base data instead of replacing it with zero.

Test after deployment:

```text
https://chili-coin-live-tracker.vercel.app/api/live?force=1
https://chili-coin-live-tracker.vercel.app/api/base?force=1
```

Search for:

```text
v23-base-reset-standalone
```
