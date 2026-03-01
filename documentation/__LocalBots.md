# Goal
Deploy all automated bots for all necessary entities. lender, borrower, and the solver. 

## Lender and Borrower Bots:                                                                     
  1. the lender bot that periodically places lend orders with randomized paramters under some range constraint.                 
  2. the borrower bot that periodically places borrow orders with randomized parameters under some range constraint.            
                                                                                                                                
Both the borrowers and lenders will randomly choose between the eligible collateral assets, min max ltv, lltv, and rates.

This can be something that's manually invoked to test functionality  

## Solver
- submit the executeBatch function once the batch window is closed. 

## Logging
The summary of all of the actions should be logged. 
The lenders and borrower actions are logged separately. 
The solver actions are logged separately. 
* Shows the state of the batch. The start time stamp and the ending timestamp.
* Shows the solver's results from the solve and what matches are being made and what the surplus score is.
* Shows the solver submitting the executeBatch function.