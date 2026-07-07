# Chili Coin Live Wallet Tracker — Version 2

A Vercel-ready holder tracker using the supplied Chili Coin mascot and circular logo.

## Version 2 changes

- Removed the transfer-feed navigation, metric card, table and related code.
- Base holder totals now use the Base ChiliCoin ERC-20 contract page at `0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`.
- The Base contract panel points directly to the token's live BaseScan transfers tab.
- The **Refresh now** button forces a non-cached request, shows progress, and confirms completion.
- Added a small-print no-investment-promotion and digital-asset risk disclaimer.

## Live sources

- **Ethereum holder total:** public Ethereum Blockscout token metadata for `0x83E8fb8D8176224FCC828EdC73E152EC1818a2dA`.
- **Base holder total:** the public BaseScan token page for `0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`, with Base Blockscout as a disclosed fallback.
- **Refresh:** automatic every 20 seconds. Manual refresh uses a force parameter and a no-store response.

## Deploy the update

Upload and replace these files in the existing GitHub repository:

- `index.html`
- `styles.css`
- `app.js`
- `api/live.js`
- `README.md`
- `SOURCE_NOTES.md`

Keep the existing `assets` folder, `package.json` and `vercel.json`. A commit to the connected production branch should create a new Vercel deployment.

## Important legal limitation

The included disclaimer is general risk-disclosure language and is not a legal opinion. It cannot determine the regulatory classification of CHI or guarantee compliance. Securities, commodities, money-transmission, consumer-protection, advertising, privacy, sanctions, tax and state-law issues may require review by qualified counsel based on the complete facts and how CHI is issued, marketed, distributed and used.
