# Source Notes — V15

## Contracts

Ethereum CHI ERC-20:
`0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`

Base CHI ERC-20:
`0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`

## Base count policy

Earlier builds showed Base Blockscout holder counters when BaseScan/Etherscan sources failed. That produced mismatches against BaseScan. V15 disables Blockscout holder counters for the visible Base holder total.

V15 attempts Base visible totals in this order:

1. Etherscan V2 / BaseScan API using `ETHERSCAN_API_KEY` and Base `chainid=8453`.
2. Legacy BaseScan token endpoints where available.
3. BaseScan token page text mirror for the overview counts.
4. Optional emergency environment overrides:
   - `BASESCAN_BASE_HOLDERS`
   - `BASESCAN_BASE_TRANSFERS`

If none of those are available, the site shows an unavailable Base total instead of a wrong Blockscout Base holder number.

## Transfer rows

The table records are latest indexed ERC-20 transfer events. Source Wallet is the ERC-20 `from` wallet and Recipient is the ERC-20 `to` wallet.


## V15 update

Base holder counts and Base transfer rows now load as separate requests. A slow Base holder count can no longer block Base CHI transfer rows, and Base Blockscout holder counters are not used for the visible Base holder total.


## V16 Fast TXN Fix

This update keeps Base holder totals and Base transfer totals separate from the latest transaction-table rows. The TXN table now requests a smaller latest-row page from the Etherscan/BaseScan API so the table is less likely to time out, while the top TXN card can still use the official BaseScan-style all-time transfer count.

## V17 Official TXN Count Fix

The TXN card is now calculated from all-time ERC-20 token-transfer counts for each chain, while the table remains a latest-row preview. This prevents the TXN card from showing only 300 recent rows or partial latest-row counts when BaseScan shows a larger transfer total.
