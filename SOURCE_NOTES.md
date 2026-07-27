# Source Notes — V8

## Contracts

- Ethereum CHI ERC-20: `0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`
- Base CHI ERC-20: `0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`

## TXN count behavior

The TXN metric is designed to count all indexed CHI ERC-20 `Transfer` events returned by the public indexers for both Ethereum and Base, then add them together.

The transaction table displays the latest loaded rows only. This is intentional so the page stays fast while the TXN card can reflect a larger all-time transfer-event count such as the total shown on BaseScan.

## Source wallet behavior

Rows attempt to show:

- Source Wallet: the transaction initiator/signer when the indexer provides a matching contract transaction record
- Token From: the ERC-20 transfer-event `from` address
- Recipient: the ERC-20 transfer-event `to` address
- Amount: the actual CHI amount transferred

Explorer totals can differ across BaseScan, Etherscan, and Blockscout because each service indexes and displays data differently.
