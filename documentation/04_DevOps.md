# DevOps

# Goal 
The goal is to have a "persistent" deployment on Monad testnet. 
1. The smart contract will be deployed on testnet.
2. The backend indexer and API will be deployed on a production environment that reads from the testnet chain. The production environment refers to the testnet chain since this is a demo.
3. The frontend will be deployed on the production environment that reads from the production backend that reads from the Monad testnet chain.

# Questions
- what devops framework should we use that's lightweight and easy to deploy? Vercel may be a good option.
- How should we handle errors? It should be relatively easy to redeploy the backend and frontend architecture upon changing the code. I'm thinking about using railway to manage the mono repo for backend and frontend with one tool.