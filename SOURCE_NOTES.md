# Source Notes — V10

## Contracts

- Ethereum CHI ERC-20: `0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`
- Base CHI ERC-20: `0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`

## Base transaction source

V10 uses the Etherscan/BaseScan V2 API with:

```text
chainid=8453
module=account
action=tokentx
contractaddress=0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8
sort=desc
```

This is intended to match the BaseScan ERC-20 token transfer tab more closely than scraping the BaseScan web page or using generic log paging.

## Fallback behavior

If `ETHERSCAN_API_KEY` is not configured or the API call fails, the site falls back to Base Blockscout token-transfer data and labels the fallback in the response warnings/source text.

## Important

Explorer/indexer data can lag live chain state. The tracker is informational and does not prove wallet ownership or reward intent.
