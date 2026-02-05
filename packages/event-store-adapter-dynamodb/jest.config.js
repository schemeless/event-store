module.exports = {
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  testTimeout: 50_000,
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};
