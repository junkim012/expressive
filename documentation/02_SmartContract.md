
## Smart Contract Design

Single contract deployment. Modularized only if contract size limit (~24KB) is reached.

---

## Deployment Parameters (Constructor)

| Parameter | Type | Description |
|---|---|---|
| `batchWindowSeconds` | `uint256` | Duration of each batch window |
| `solverFeeRate` | `uint256` | Solver fee in basis points |
| `liquidationBonusRate` | `uint256` | Liquidation bonus in basis points |
| `collateralAssets` | `address[]` | Whitelisted collateral assets |
| `borrowAssets` | `address[]` | Whitelisted borrow assets |
| `oracles` | `address[]` | Oracle address per collateral asset (parallel to `collateralAssets`) |

All parameters and whitelists are immutable after construction.

---

## Design Decisions

