import type { iCompareResult } from '../../core/parity/compare.js'
import {
	acceptedNotes,
	extraNotes,
	pickSample,
	qualified,
	redactColumns,
	summarize,
	type tAcceptedDifferences
} from '../../core/parity/helpers.js'

import { MASK, PERSONAL_COLUMNS } from './personal-data.js'

/**
 * Peças comuns às paridades da VTEX (pedidos e catálogo). Sem I/O. As genéricas moraram aqui e agora vêm de
 * src/core/parity/helpers.ts; ficam reexportadas para os imports da VTEX não mudarem.
 */

/** Diferença em coluna pessoal sai com `expected` e `actual` mascarados (colunas e máscara da VTEX). */
const redactPersonal = (table: string, results: iCompareResult): iCompareResult =>
	redactColumns(table, results, PERSONAL_COLUMNS, MASK)

export { acceptedNotes, extraNotes, pickSample, qualified, redactPersonal, summarize }
export type { tAcceptedDifferences }
