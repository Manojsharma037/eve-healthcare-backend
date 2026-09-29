// Load environment variables from .env into process.env before anything else.
require('dotenv').config();

const app = require('./app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`EVE Healthcare Backend is running on port ${PORT}`);
});
