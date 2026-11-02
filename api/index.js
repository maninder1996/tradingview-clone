// Vercel serverless entry: every request that is not the public login page is rewritten here
// (see vercel.json). The handler enforces the login before serving the app or any API.
const { handle } = require("../server.js");

module.exports = (req, res) => handle(req, res);
