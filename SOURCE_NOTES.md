# Source Notes — V12

The previous no-key BaseScan text mirror helped match displayed BaseScan counts when it worked, but it caused slow or failed dashboard loads. V12 prioritizes uptime and speed:

- Ethereum counters/transfers: Ethereum Blockscout public indexer
- Base counters/transfers: Base Blockscout public indexer
- BaseScan: linked as the official review page, not blocking the live dashboard

This means the dashboard should load faster and more consistently, but explorer/indexer counts can differ from BaseScan at a given moment.


## V13 correction

Base holders should not rely on Blockscout counters when exact BaseScan alignment is required. V13 uses the Etherscan API V2 endpoint first when `ETHERSCAN_API_KEY` is available in Vercel. Base is queried with `chainid=8453`. If the UI still says "Base Blockscout token counters," the production deployment is not seeing a valid Etherscan API key or has not been redeployed after the environment variable was added.
