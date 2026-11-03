const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

const connectTestDb = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/marketsphere_test';
  if (mongoose.connection.readyState === 0) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    } catch (err) {
      // If local MongoDB is not reachable, fall back to MongoMemoryServer
      if (!mongoServer) {
        mongoServer = await MongoMemoryServer.create();
      }
      await mongoose.connect(mongoServer.getUri());
    }
  }
  await clearDatabase();
};

const disconnectTestDb = async () => {
  await clearDatabase();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    try {
      await mongoServer.stop();
    } catch (e) {
      // Ignore cleanup error if already stopped
    }
    mongoServer = null;
  }
};

const clearDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany();
    }
  }
};

module.exports = { connectTestDb, disconnectTestDb, clearDatabase };
