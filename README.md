# Chili Coin Live Tracker — V19 Transfer Log Fix

Use this replacement set to update the existing Vercel/GitHub deployment.

## What changed

- TXN counts now use ERC-20 Transfer logs instead of `tokentx` totals.
- Base transaction rows now load from the same Transfer log source used by explorer transfer tabs.
- Base rows stay visible in the CHI Transaction Flow table.
- Holder loading and transaction loading remain separate so one slow source does not kill the other.

## Upload

Upload every item inside this folder to GitHub, including the full `api` folder.

Commit message:

`Fix Base TXN with Transfer logs`

Then wait for Vercel to redeploy.
