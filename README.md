# Chili Coin Live Wallet Tracker — Version 3 replacement files

This update restores the Custodial Reward Activity section using the correct Base ChiliCoin ERC-20 contract:

`0x25Ec4c3eF2A21d178922Fb02c7F92111852165E8`

## What changed

- Removed the obsolete ERC-1155 activity logic.
- The activity table now loads recent ERC-20 transfers for the Base CHI token automatically.
- No API key or wallet address is entered into the page.
- Amounts are decoded using the token's decimal field, so the table displays 5 CHI or any other actual transfer amount.
- Rows show time, event, sender, recipient, amount and a BaseScan transaction link.
- Automatic refresh remains every 20 seconds; both refresh buttons force a non-cached request.

## Update the existing GitHub project

Upload all six items from this folder to the top level of the existing GitHub repository. Allow GitHub to replace the files with the same names, commit to `main`, and Vercel will redeploy automatically.

The existing `assets`, `package.json` and `vercel.json` files should remain in the repository.
