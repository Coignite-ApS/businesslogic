export interface Expression {
	name: string;
	expression: string;
	scope?: string;
}

export interface SinglePayload {
	formula: string;
	locale?: string;
	data?: unknown[][];
	expressions?: Expression[];
}

export interface BatchPayload {
	formulas: string[];
	locale?: string;
	data?: unknown[][];
	expressions?: Expression[];
}

export interface SheetFormula {
	cell: string;
	formula: string;
	sheet?: string;
}

export interface SheetPayload {
	data?: unknown[][];
	sheets?: Record<string, unknown[][]>;
	formulas: SheetFormula[];
	locale?: string;
	expressions?: Expression[];
}

export interface FormulaExample {
	id: string;
	sort: number;
	label: string;
	mode: 'single' | 'batch' | 'sheet';
	advanced: boolean;
	formula: string | null;
	formulas: string[] | null;
	sheet_formulas: { cell: string; formula: string; sheet?: string }[] | null;
	data: string | null;
	sheet_data: string | null;
	sheet_data_mode: 'data' | 'sheets' | null;
}
