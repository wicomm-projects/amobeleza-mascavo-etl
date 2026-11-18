import js from '@eslint/js'
import unusedImports from 'eslint-plugin-unused-imports'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
	{
		ignores: ['dist/**']
	},

	js.configs.recommended,
	...tseslint.configs.recommended,

	{
		files: ['**/*.{ts,tsx,js,mjs,cjs}'],

		languageOptions: {
			globals: globals.node
		},

		plugins: {
			'unused-imports': unusedImports
		},

		rules: {
			// Remove imports não usados
			'unused-imports/no-unused-imports': 'error',

			// Desabilita as versões padrão em favor das do TS
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': 'off',

			'padding-line-between-statements': [
				'warn',

				// Sempre antes de return
				{ blankLine: 'always', prev: '*', next: 'return' },

				// Separar blocos de lógica
				{ blankLine: 'always', prev: '*', next: ['if', 'for', 'while', 'switch', 'try'] },
				{ blankLine: 'always', prev: ['if', 'for', 'while', 'switch', 'try'], next: '*' },

				// Separar variáveis do restante
				{ blankLine: 'always', prev: ['const', 'let'], next: '*' },

				// Agrupar variáveis
				{ blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },

				// Separar imports
				{ blankLine: 'always', prev: 'import', next: '*' },

				// Agrupar imports
				{ blankLine: 'any', prev: 'import', next: 'import' }
			]
		}
	},

	// Trava de segurança: fora de src/core/db, ninguém abre conexão crua com banco. Todo acesso passa por
	// src/core/db/index.ts (writer com marcador local, ref-reader só leitura, conexão protegida).
	{
		files: ['src/**/*.ts'],
		ignores: ['src/core/db/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['mysql2', 'mysql2/*'],
							message: 'Acesso a banco só por src/core/db/index.js (travas de segurança).'
						},
						{
							group: ['**/core/db/*', '!**/core/db/index.js', '**/db/*', '!**/db/index.js'],
							message: 'Importe de src/core/db/index.js: pools e conexões cruas não saem do núcleo.'
						}
					]
				}
			]
		}
	}
])
