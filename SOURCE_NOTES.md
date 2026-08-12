# Source Notes — V9

## CHI contracts

Ethereum CHI ERC-20:
`0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`

Base CHI ERC-20:
`0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`

BaseScan transfer page:
`https://basescan.org/token/0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8#transactions`

## Base transaction reporting fix

The BaseScan token transfer tab is showing ERC-20 `Transfer` events emitted by the Base CHI contract.

The tracker now treats:

- `Source Wallet` = ERC-20 Transfer event `from` address, meaning the wallet CHI flowed out of.
- `Recipient` = ERC-20 Transfer event `to` address, meaning the wallet CHI flowed into.
- `Amount` = decoded ERC-20 transfer value using 18 decimals.
- `TXN` = transaction hash that emitted the Transfer event.

This avoids confusing the token-event sender with a separate transaction signer or backend caller.

## Data sources

Preferred Base mode:

- Etherscan/BaseScan V2 log endpoint via `https://api.etherscan.io/v2/api`
- Base Mainnet `chainid=8453`
- Transfer topic `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`
- Requires server-side `ETHERSCAN_API_KEY` in Vercel

Fallback mode:

- Blockscout V2 token counters: `/api/v2/tokens/{address_hash}/counters`
- Blockscout V2 token transfers: `/api/v2/tokens/{address_hash}/transfers`

The public site links to BaseScan for direct explorer review.
