module.exports = {
  roots: ['<rootDir>/src'],
  testTimeout: 50_000,
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@schemeless/(.*)$': '<rootDir>/../$1/src',
  },
};
