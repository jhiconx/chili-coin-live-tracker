# Source Notes — V22

Base CHI contract:

`0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`

V22 stops treating Base holder count as a separate scraper/API problem. It pulls Base CHI ERC-20 Transfer events using the explorer token-transfer API, counts the transfers, and computes current holders by replaying Transfer balances from the full transfer history.

This avoids three prior failure modes:

1. BaseScan page mirrors being slow, stale, or unavailable.
2. Blockscout Base counters disagreeing with BaseScan.
3. Failed Base refreshes overwriting good values with `0`.
