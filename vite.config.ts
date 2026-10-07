// Root CLI compatibility. All application configuration lives in web/.
import webConfig from './web/vite.config.ts';
import process from 'node:process';

// Child-process tests resolve their executable scripts from the web package.
process.chdir(`${import.meta.dirname}/web`);

export default {
  staged: {
    '*': 'vp check --fix',
  },
  ...webConfig,
  root: `${import.meta.dirname}/web`,
  lint: {
    ...webConfig.lint,
    ignorePatterns: ['web/dist', 'web/scripts', 'web/server', 'web/src/components/ui/**', 'ios/build'],
  },
  fmt: {
    ...webConfig.fmt,
    ignorePatterns: ['web/dist', 'web/node_modules', 'web/demo-data', 'web/scripts', 'ios/build'],
  },
};
