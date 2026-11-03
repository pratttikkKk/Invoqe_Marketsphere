module.exports = {
  testTimeout: 60000,
  testEnvironment: 'node',
  maxWorkers: 1,
  forceExit: true,
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js']
};
