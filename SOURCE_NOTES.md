# Source Notes — V24

V24 removes the previous mixed Base logic and uses one source pattern for TXN totals:

- Base TXN total = count of CHI ERC-20 transfer events returned from Etherscan API V2 with `chainid=8453` and `contractaddress=0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`.
- Ethereum TXN total = count of CHI ERC-20 transfer events returned from Etherscan API V2 with `chainid=1` and `contractaddress=0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`.
- Displayed all-chain TXN = Base TXN + Ethereum TXN.

No Blockscout holder counters are used for the Base holder card.
No failed Base response is converted into `0`.
