# Chili Coin Live Wallet Tracker — V15 Split Base Calls

This release fixes the Base holder-count mismatch.

## What changed

- The Base holder card no longer uses Blockscout holder counters.
- Base visible holder/transfer totals now use official BaseScan-style sources first:
  1. Etherscan/BaseScan API, if `ETHERSCAN_API_KEY` is configured in Vercel.
  2. BaseScan legacy token API fallbacks, if available.
  3. BaseScan public token page text mirror.
- If those official-style sources are unavailable, the Base holder number shows unavailable rather than displaying a wrong Blockscout count.
- Blockscout can still be used for latest transfer rows if the API transaction feed fails, but not for the visible Base holder total.

## Correct BaseScan comparison

Compare the site to this BaseScan page:

`https://basescan.org/token/0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8#transactions`

On the tracker:

- **Base Holders** should match BaseScan Overview → Holders when the official source is available.
- **TXN** should include ETH + Base transfer-event totals.
- The transaction table shows latest transfer rows and is not meant to list every historical transfer row on the page.

## Deploy

Upload everything in this replacement folder to GitHub, including the `api` folder, then redeploy on Vercel.

Commit message suggestion:

`Fix Base holder count to use BaseScan official totals`


## V15 update

Base holder counts and Base transfer rows now load as separate requests. A slow Base holder count can no longer block Base CHI transfer rows, and Base Blockscout holder counters are not used for the visible Base holder total.


## V16 Fast TXN Fix

This update keeps Base holder totals and Base transfer totals separate from the latest transaction-table rows. The TXN table now requests a smaller latest-row page from the Etherscan/BaseScan API so the table is less likely to time out, while the top TXN card can still use the official BaseScan-style all-time transfer count.

## V17 Official TXN Count Fix

This update fixes the top **TXN / All Chain Transactions** card so it uses all-time ERC-20 transfer-event counts instead of the number of latest rows loaded into the visible table. With `ETHERSCAN_API_KEY` configured, the API requests the full indexed `tokentx` list count for Ethereum and Base separately, then sums them for the TXN card. The table still loads only the latest rows so the dashboard stays fast.
