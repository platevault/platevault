import type { Rule } from 'eslint';

declare const plugin: {
  rules: {
    'no-raw-svg-colour': Rule.RuleModule;
  };
};

export default plugin;
