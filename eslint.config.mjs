import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'build/**',
            '.trae/**',
            'wosai-ui-spec/**',
            'coverage/**',
            'web/shared/pinyin-pro.esm.js',
            '*.min.js',
            '*.bundle.js',
            'scripts/*.cjs',
        ],
    },
    {
        files: ['web/**/*.js', 'web/**/*.mjs', 'scripts/**/*.{js,mjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                app: 'readonly',
                LiteGraph: 'readonly',
                LGraph: 'readonly',
                LGraphCanvas: 'readonly',
                LGraphNode: 'readonly',
                LGraphGroup: 'readonly',
            },
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-undef': 'error',
            'no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    // ComfyUI and browser callbacks frequently require a stable
                    // positional signature even when this extension does not use
                    // every argument.  Keep checking local variables/imports,
                    // but do not report intentionally unused callback/catch args.
                    args: 'none',
                    caughtErrors: 'none',
                    ignoreRestSiblings: true,
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                },
            ],
            'no-redeclare': 'error',
            // 许多兼容层采用“尽力而为”的清理；空 catch 是有意忽略宿主差异。
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-console': 'off',
            eqeqeq: ['error', 'smart'],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-trailing-spaces': 'error',
            'eol-last': ['error', 'always'],
        },
    },
];
