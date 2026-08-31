# Source Notes

Contracts:

- Ethereum CHI: `0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`
- Base CHI: `0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`

V23 changes:

- Base was rebuilt as a standalone source path.
- `/api/base` returns Base-only diagnostics.
- Base holders and Base TXN totals prioritize the visible BaseScan token page.
- Base latest rows use ERC-20 token transfer feeds.
- Failed Base refreshes do not become `0`.
- Browser localStorage and server memory cache preserve last good Base values.
