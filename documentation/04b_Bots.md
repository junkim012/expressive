# Solver Bot
## Goal

This solver bot should be deployable in both local and staging. But it should be environment-conscious. 

## Repo
Create a new directory called expressive-lending since a solver is something that can be independently developed to improve its algorithm and the devops process. 

## Local vs. Staging

For staging, the three EOA private and public keys should just exist in the .env variable in the expressive-lending/bot directory.
On bot startup, if it doesn't have more than 5 MON in gas, throw an error. This should be specified as MIN_GAS environmental variable.

If local, the EOA should still read the private/public keys from the environmental variable. However, just mint large amount of the native token using anvil and transfer it to these EOAs for local. 

## Number of solvers
Create three solver EOAs. This means there should be three keys.
These three solver EOAs should submit three different batches of varying surpluses. 
This is to demonstrate that the auction correctly picks the winner with the highest surplus. 

## Private Keys
Because we are using the same keys in both staging and local, we SHOULD NOT use anvil private keys. Anvil private key balances will just get scraped on testnet. 

## DevX
I want to be able to run some kind of `deploy-solver` command with env specified as either staging or local. I should be able to manually invoke it. Also, other code should be able to progrmmatically invoke it. 

This means the e2e/dev.sh should be able to call this deploy-solver with a local environment specified to automatically deploy the solver on local environment.  

But the point is to reuse the same code for both staging and local deployments. 

## Observability
For each bot, it should log its batch, the expected surplus, and confirmations for submitting a batch, confirmations for executing a batch, and what 

similar to `make logs`, we should have a `make solver-logs` that allows the developer to observe. 


# Borrow and Lend Bot
In the /bot directory, expand it from just the solver bot to a lender and a borrower bot. 

There is already an implementation of the logic in actions.sh 

Keep the quantitative logic the same, except we want to abstract the logic into this bot deployment flow similar to the solver deployment flow. Such that both the borrower and lender bots can be separately invoked, and deployed to staging or local.

The same staging vs. local rule for the solver applies to the Borrow and Lend Bots.

Add logs on create lend/borrow order events. 