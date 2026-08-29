# Source Notes — V12

The previous no-key BaseScan text mirror helped match displayed BaseScan counts when it worked, but it caused slow or failed dashboard loads. V12 prioritizes uptime and speed:

- Ethereum counters/transfers: Ethereum Blockscout public indexer
- Base counters/transfers: Base Blockscout public indexer
- BaseScan: linked as the official review page, not blocking the live dashboard

This means the dashboard should load faster and more consistently, but explorer/indexer counts can differ from BaseScan at a given moment.
