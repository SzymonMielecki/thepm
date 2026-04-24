# thePM

I've participated in many hackathons. In each and every one of them, I've run into an issue that we've talked about a lot but didn't move. We've lost track of the mentioned issues often and lost what the product really does in this agentic/vibe-coded era. We've often just recorded our conversations and then put it straight into Claude.
thePM always listens. You just leave your phone with microphone on, and issues and PRD are drafted based on all of your brainstorming.

Usage:

- run `pnpm install` to install the dependencies
- run `pnpm build` to build the bridge binary and server
- run `pnpm start` to start the server
- run `pnpm link --global` to make thePM available globally
- run `thepm bridge --linear-api-key {YOUR_LINEAR_API_KEY} --lin-team-id {YOUR_LINEAR_TEAM_ID}` within the repo you are working on
- open the link given by the above command in your browser, and open the mobile capture while copying the token.
- start capturing
- the linear issues are created and the PRD is updated with every accepted ticket
