import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import prettier from 'eslint-plugin-prettier/recommended';

export default [
    js.configs.recommended,
    ...tseslint.configs.recommended,
    importX.configs.typescript,
    prettier,
    {
        ignores: ['node_modules', 'dist', '**/*.js', '**/*.mjs']
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: 'tsconfig.json'
            }
        },
        plugins: {
            unicorn,
            'import-x': importX
        },
        settings: {
            'import-x/resolver': {
                typescript: true
            }
        },
        rules: {
            'import-x/order': [
                'warn',
                {
                    groups: [
                        'builtin',
                        'sibling',
                        'parent',
                        'index',
                        'external',
                        'internal',
                        'unknown',
                        'object',
                        'type'
                    ],
                    'newlines-between': 'always'
                }
            ],
            '@typescript-eslint/no-restricted-imports': [
                'warn',
                {
                    patterns: [
                        {
                            group: [
                                '**/../../common',
                                '**/../../core',
                                '**/../../mcp'
                            ],
                            message: "Import from '@tams/*' instead."
                        }
                    ]
                }
            ],
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/explicit-member-accessibility': 'warn',
            'array-callback-return': 'error',
            'default-case-last': 'error',
            'dot-notation': 'error',
            eqeqeq: 'error',
            'max-classes-per-file': 'error',
            'no-eval': 'error',
            'no-extend-native': 'error',
            'no-implicit-coercion': 'error',
            'no-lonely-if': 'warn',
            'no-unneeded-ternary': 'warn',
            'prefer-const': 'warn',
            'prefer-template': 'warn'
        }
    }
];
