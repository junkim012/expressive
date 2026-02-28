## The Story

## Problems with pooled lending markets 

Problems for Lenders
1. Lacks counterparty selection. As a lender, I am not able to specify conditions that my borrower has to satisfy to borrow my money. 

2. Lacks granular rate specification. As a lender, I am subject to the interest rate curve, and cannot create a gradient of orders where there's different quantities of tokens supplied at different rates.

Problems for Borrowers
1. Borrowers are subject to utilization driven interest rates that can spike due to liquidity crisis. 

Solutions
1. Fixed rate, fixed maturity bonds. The borrowers and lenders lock in a fixed rate for a given period.
2. Expressivity for Lenders. Lenders can quote loans with different amount at different rates, and adjust them according to the market. 
3. Trustless. The system is still overcollateralized. If the collateral value falls below the Liquidation LTV before loan maturity, the collateral gets liquidated and the loan is closed. The remaining collateral after partial liquidation is returned to the borrower. And the borrower doesn't have to pay anything back as the debt is now paid off via liquidations. 
4. 

Historically
* multi-dimensional settlement for spot trading like uniswapX and cowswap. But for lending, it was always market-segmented i.e. Morpho Blue. Leads to lack of intent expressivity since a new market needs to be created for a single parameter change. 


Visuals
- Create an animation where in the orderbook, the lo visual 