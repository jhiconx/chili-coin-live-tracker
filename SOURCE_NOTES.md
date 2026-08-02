# Source Notes — V10

## Contracts

- Ethereum CHI ERC-20: `0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`
- Base CHI ERC-20: `0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`

## Network structure

Ethereum Mainnet is the Layer 1 network. Base is a separate EVM-compatible Layer 2 that executes transactions independently and settles batches back to Ethereum. The two networks have separate transaction histories, explorers, CHI contract addresses, balances and fees. Assets move between them through a bridge.

## Live transfer behavior

The serverless endpoint reads the newest token-transfer records from the Blockscout API v2 endpoint:

- `/api/v2/tokens/{token-address}/transfers`

Blockscout returns keyset pagination data in `next_page_params`. The endpoint follows those page parameters and combines Ethereum and Base records by timestamp.

## TXN total

The TXN metric uses:

- `/api/v2/tokens/{token-address}/counters`

The Ethereum and Base `transfers_count` values are added together. This is separate from the smaller set of rows loaded for the paginated table.

## Table pagination

- 20 records are displayed per page.
- The table can hold up to the newest 300 combined records returned by the endpoint.
- Wallet and flow filters are applied before pagination.
- Filtering resets the table to page 1.

## Source wallet behavior

Rows attempt to show:

- Source Wallet: the transaction initiator/signer when the compatible transaction indexer provides a match.
- Token From: the ERC-20 transfer-event `from` address.
- Recipient: the ERC-20 transfer-event `to` address.
- Amount: the CHI amount in the transfer event.

When a separate transaction signer cannot be resolved, Source Wallet falls back to Token From.

## Timing

The dashboard displays two different times:

- `Updated`: when the dashboard API response was fetched.
- `Latest record`: the timestamp on the newest returned CHI transfer.

Those values should not be treated as the same thing. Public explorer indexing can lag the newest block.


## V11 Base freshness fix

The latest Base CHI rows are no longer dependent only on the Base Blockscout token index.

The server now:
- Reads recent CHI `Transfer` event logs directly from Base JSON-RPC.
- Merges those records with the existing historical Blockscout rows.
- Uses transaction and block RPC calls to obtain the transaction signer and timestamp.
- Deduplicates matching RPC and Blockscout records by chain, transaction hash, and log index.

For production reliability, set the Vercel environment variable `BASE_RPC_URL` to a production Base RPC endpoint. If it is not set, the code falls back to `https://mainnet.base.org`, which Base documents as rate limited and not intended for production systems.
