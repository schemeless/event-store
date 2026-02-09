module.exports = {
  roots: ['<rootDir>/src'],
  transform: {
    // Keep string-style transform for Jest 26 / ts-jest 26 compatibility in RN package.
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@schemeless/(.*)$': '<rootDir>/../$1/src',
  },
};
