// Vercel serverless entry point.
//
// The whole app is one Express instance defined in ../server.js; this file just
// exposes it as a function under /api, which is the layout Vercel routes to
// while preserving the caller's original URL. Pointing the catch-all rewrite at
// a root-level file instead (destination "/server.js") handed Express the
// rewritten path, so every non-root request 404'd.
module.exports = require('../server.js');
