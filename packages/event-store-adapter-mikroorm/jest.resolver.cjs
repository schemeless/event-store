const fs = require('fs');
const path = require('path');
const defaultResolver = require('jest-resolve/build/defaultResolver').default;

const BUILTIN_DIR = path.resolve(__dirname, 'jest-node-builtins');

module.exports = (request, options) => {
  if (request.startsWith('node:')) {
    const moduleName = request.slice(5);
    const stubPath = path.join(BUILTIN_DIR, `${moduleName}.cjs`);

    if (!fs.existsSync(stubPath)) {
      fs.mkdirSync(BUILTIN_DIR, { recursive: true });
      fs.writeFileSync(stubPath, `module.exports = require('${moduleName}');\n`);
    }

    return stubPath;
  }

  return defaultResolver(request, options);
};
