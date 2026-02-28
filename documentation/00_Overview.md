## What am I building?

A decentralized lending protocol operated via a blockchain based consensus enginen.

An analogous product is something like Hyperliquid, which is a perpetual trading exchange built on the blockchain. The matching engine and the APIs for receiving and executing orders are therefore decentralized.

## Business Logic

The lending protocol can be conceptualized as a bond marketplace. 

The borrowers are selling bonds which encodes the maturity date, the interest rate, the collaterals, and the 

The lenders who buy these bonds are lending liquidity to the borrowers at a fixed rate and fixed maturity.

### Fungibility

### Analogy

How does the corporate treasury bond markets work? 
What is the "atomic" unit of a bond that still maintains fungibility? 
Put another way, what defines a fungible unit of a bond? 
- The matury must be the same. 
- The interest rate must be the same. 
- The accepted borrower collateral set must be the same.
- The liquidation LTV must be the same. 

## Discussion Questions 

1. Should these over-collateralized bonds be liquidatable?
- The borrower sells a bond with 100 bitcoin collateral at a 70% LTV. and let's assume 1 bitcoin is worth 1 million dollars. 
  - The lenders should only be allowed to buy more than 70 million dollars worth of these bonds.
  - While these bonds haven't matured yet, if the borrowers' collateral goes down, then should it be liquidated? 
  - If the collateral is getting sold, should it autoclose the outsatnding non-matured bond? Or should it just compensate the lenders when the bonds mature?
  - How does this work in TradFi?

2. Can lenders and borrowers both create orders? Or can only one party make these orders?
- Borrowers can create bonds and sell them. 
- Can lenders also create standing orders that the borrowers can pick up? 
  - If lenders cannot create orders, it's hard for lenders to express lender side demand if there are no borrowers yet.

3. How  should price discovery work? How does this relate to "rate" discovery?
- There's two conflicting ideas that confuse me. 
- The borrow lend market
  - Could be be issuance of bonds.
  - And the trading of these bonds in an exchange. 
  - In this model, what dictates the rates?

4. What are the different types of loans and how do they work? How are they different from each other?
- government bonds
- corporate bonds
- student loans
- credit card loans