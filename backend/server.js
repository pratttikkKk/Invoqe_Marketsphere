require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const { getJwtSecret } = require('./middlewares/auth');
const emailService = require('./services/emailService');

// Fail-fast verification of required secrets
try {
  getJwtSecret();
  emailService.verifyConfiguration();
} catch (err) {
  console.error('[STARTUP ERROR]', err.message);
  process.exit(1);
}

const PORT = process.env.PORT || 5002;

// Connect Database
connectDB();

const server = app.listen(PORT, () => {
  console.log(`[SERVER] MarketSphere running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

// Graceful Shutdown Protocol
const handleGracefulShutdown = (signal) => {
  console.log(`\n[SHUTDOWN] Received ${signal}. Closing HTTP server gracefully...`);
  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed.');
    mongoose.connection.close(false).then(() => {
      console.log('[SHUTDOWN] MongoDB connection closed.');
      process.exit(0);
    }).catch(err => {
      console.error('[SHUTDOWN] Error closing MongoDB:', err);
      process.exit(1);
    });
  });

  // Force exit if shutdown takes longer than 10 seconds
  setTimeout(() => {
    console.error('[SHUTDOWN] Forceful shutdown timeout exceeded. Exiting.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));