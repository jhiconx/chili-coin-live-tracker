# Source Notes — V11

Base CHI contract:
`0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`

Ethereum CHI contract:
`0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`

The tracker now uses a no-key source order for Base:

1. Public BaseScan token page/text mirror for displayed holder and transfer totals.
2. Blockscout public API counters as fallback.
3. Blockscout public token-transfer feed for latest rows.

Important: BaseScan's `#transactions` tab shows token transfer events. That number is not the same thing as holder count. The tracker separates Base Holders from TXN / All Chain Transactions.
