# Source Notes — V6

## Contracts

- Ethereum CHI ERC-20: `0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`
- Base CHI ERC-20: `0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`

## Live sources

- Holder counts are requested from public explorer/indexer sources through `/api/live.js`.
- Base holder count attempts BaseScan first, with Blockscout as a fallback.
- Transaction-flow rows are requested from public Blockscout ERC-20 transfer indexers for Ethereum and Base.
- Explorer links point users back to Etherscan and BaseScan.

## Important limitation

The TXN card and transaction table show the latest indexed transfer records returned by the public sources. They are intended for live visibility, not a forensic accounting report or a verified all-time transaction count.
