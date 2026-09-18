import js from "@eslint/js";
import globals from "globals";
import stylistic from "@stylistic/eslint-plugin";

export default [
  js.configs.recommended,
  {
    "files": ["**/*.js"],
    "languageOptions": {
      "ecmaVersion": 2022,
      "sourceType": "module",
      "globals": {
        ...globals.node
      }
    },
    "plugins": {
      "@stylistic": stylistic
    },
    "rules": {
      "global-require": "off",
      "no-inline-comments": "error",
      "no-plusplus": "error",
      "no-nested-ternary": "error",
      "no-lonely-if": "error",
      "no-array-constructor": "error",
      "no-delete-var": "error",
      "no-param-reassign": "error",
      "no-return-assign": "error",
      "max-params": [
        "error",
        4
      ],
      "max-statements": [
        "error",
        15
      ],
      "no-loss-of-precision": "error",
      "no-unreachable-loop": "error",
      "require-atomic-updates": "error",
      // ESLint >= 9 also counts default parameter values towards complexity,
      // so the effective budget is the same as the old limit of 5.
      "complexity": [
        "error",
        6
      ],
      "no-negated-condition": "error",
      "no-use-before-define": "error",
      "no-shadow": "error",
      "no-labels": "error",
      "no-throw-literal": "error",
      "default-case": "error",
      "default-case-last": "error",
      "no-caller": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new": "error",
      "no-new-func": "error",
      "no-new-object": "error",
      "no-new-wrappers": "error",
      "no-useless-concat": "error",
      "func-names": [
        "error",
        "never"
      ],
      "func-style": [
        "error",
        "expression",
        {
          "allowArrowFunctions": true
        }
      ],
      "max-depth": [
        "error",
        4
      ],
      "prefer-const": "error",
      "prefer-destructuring": [
        "error",
        {
          "VariableDeclarator": {
            "array": false,
            "object": true
          },
          "AssignmentExpression": {
            "array": false,
            "object": false
          }
        }
      ],
      "prefer-rest-params": "error",
      "prefer-spread": "error",
      "prefer-template": "error",
      "object-shorthand": [
        "error",
        "properties"
      ],
      "no-var": "error",
      "no-useless-computed-key": "error",
      "array-callback-return": "error",
      "consistent-return": "error",
      "dot-notation": "error",
      "eqeqeq": "error",
      "no-eq-null": "error",
      "no-implicit-coercion": "error",
      "no-proto": "error",
      "yoda": "error",
      "no-unused-vars": [
        "error",
        {
          "ignoreRestSiblings": true
        }
      ],
      "no-sync": [
        "error"
      ],
      "no-restricted-syntax": [
        "error",
        "ThisExpression"
      ],

      "@stylistic/quote-props": "warn",
      "@stylistic/quotes": [
        "error",
        "double",
        {
          "allowTemplateLiterals": "always"
        }
      ],
      "@stylistic/no-multiple-empty-lines": "error",
      "@stylistic/keyword-spacing": "error",
      "@stylistic/max-len": [
        "warn",
        {
          "code": 140
        }
      ],
      "@stylistic/max-statements-per-line": [
        "error",
        {
          "max": 1
        }
      ],
      "@stylistic/no-tabs": "error",
      "@stylistic/array-bracket-newline": [
        "error",
        "consistent"
      ],
      "@stylistic/arrow-parens": "error",
      "@stylistic/no-confusing-arrow": "error",
      "@stylistic/rest-spread-spacing": [
        "error",
        "never"
      ],
      "@stylistic/template-curly-spacing": [
        "error",
        "never"
      ],
      "@stylistic/no-multi-spaces": "error",
      "@stylistic/indent": [
        "error",
        2
      ],
      "@stylistic/object-curly-spacing": [
        "error",
        "always"
      ],
      "@stylistic/object-curly-newline": [
        "error",
        {
          "consistent": true,
          "multiline": true
        }
      ],
      "@stylistic/space-before-blocks": "error",
      "@stylistic/space-before-function-paren": [
        "error",
        "always"
      ],
      "@stylistic/spaced-comment": "error",
      "@stylistic/no-whitespace-before-property": "error",
      "@stylistic/brace-style": [
        "error",
        "1tbs",
        {
          "allowSingleLine": false
        }
      ],
      "@stylistic/eol-last": [
        "error",
        "always"
      ],
      "@stylistic/semi": [
        "error",
        "always"
      ],
      "@stylistic/function-call-spacing": [
        "error",
        "never"
      ]
    }
  }
];
