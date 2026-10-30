// Vercel serverless entry: all /api/* requests are rewritten here (see vercel.json)
const { api } = require('../server.js');

module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  return api(url, res);
};
