'use strict'

module.exports = {
  preset: 'ts-jest',
  globals: { 'ts-jest': { tsconfig: 'tsconfig.test.json' } },
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  passWithNoTests: true
}
