# Chili Coin Live Wallet Tracker — V24 Simple TXN Sum

This build resets the TXN logic to exactly what was requested:

**TXN = BaseScan CHI ERC-20 Transfers + Etherscan CHI ERC-20 Transfers**

The backend pulls the full ERC-20 `tokentx` history for:

- Base CHI: `0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`, chain `8453`
- Ethereum CHI: `0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`, chain `1`

It then counts the transfer events directly and adds them together. Holder counts are computed from the same full transfer histories, not from Blockscout.

Vercel environment variable required:

```text
ETHERSCAN_API_KEY
```

After deploying, test:

```text
/api/live?force=1
```

Search for:

```text
v24-simple-txn-sum
```
