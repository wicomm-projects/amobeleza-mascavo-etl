export default {
	// Formatação
	arrowParens: 'avoid',
	bracketSpacing: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 120,
	tabWidth: 4,
	useTabs: true,
	semi: false,
	quoteProps: 'consistent',

	// Ordenação de imports
	plugins: ['@trivago/prettier-plugin-sort-imports'],

	importOrder: [
		'^node:(.*)$', // node:fs, node:path...
		'^(fs|path|os|crypto|stream|util|url|http|https|zlib|events|buffer|process)(/.*)?$',

		'<THIRD_PARTY_MODULES>',

		'^@/(.*)$', // alias (@/*)

		'^../(.*)$',
		'^./(.*)$'
	],

	importOrderSeparation: true,
	importOrderSortSpecifiers: true
}
