Monorepo with the following structure
1. Smart contracts under `contracts/` This should be a foundry project for solidity source code and scripts.
2. Frontend code under `app/` this should be a react app that will have the code for the frontend application. 
3. Backend code under `infra/` This will have the indexer and necessary APIs built on top of the indexer to share data about indexed protocol events. 

    Discuss with me effective ways to architect the monorepo. 