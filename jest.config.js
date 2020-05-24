module.exports = {
  roots: ['<rootDir>/src'],
  projects: ['examples/*'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  'ts-jest': {
    isolatedModules: true
  },
  globals: {
    'ts-jest': {
      isolatedModules: true
    }
  }
};
