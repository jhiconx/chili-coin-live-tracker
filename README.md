# Chili Coin Live Tracker — V11 No-Key BaseScan Fix

This replacement package removes the need for an Etherscan/BaseScan API key for the public-facing tracker.

What changed:

- Base holder totals now prefer the public BaseScan token page/text mirror when available.
- Base transfer totals now prefer the BaseScan token transactions page count when available.
- Blockscout remains a fallback for latest transaction rows and public counter data.
- The TXN table still links each transaction back to BaseScan/Etherscan.
- No Vercel environment variable is required.

Upload everything inside this folder to GitHub, including the full `api` folder.
