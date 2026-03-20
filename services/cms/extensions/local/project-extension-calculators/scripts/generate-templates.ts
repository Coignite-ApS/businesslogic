/**
 * Generator for calculator template library.
 * Creates Excel files + seed SQL for all 17 professional templates.
 *
 * Run: cd scripts && npm install && npx tsx generate-templates.ts
 */
import ExcelJS from 'exceljs';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TemplateInput {
	[key: string]: {
		mapping: string;
		title: string;
		description?: string;
		type: 'number' | 'string' | 'integer';
		default?: number | string;
		minimum?: number;
		maximum?: number;
		transform?: 'percentage';
		required?: boolean;
		order: number;
	};
}

interface TemplateOutput {
	[key: string]: {
		mapping: string;
		title: string;
		description?: string;
		type: 'number' | 'string';
		transform?: 'percentage';
		readOnly?: boolean;
		order: number;
	};
}

interface TemplateDef {
	name: string;
	description: string;
	icon: string;
	industry: string;
	featured: boolean;
	sort: number;
	sheets: Record<string, unknown[][]>;
	formulas: Record<string, Record<string, string>>;
	input: { type: 'object'; properties: TemplateInput };
	output: { type: 'object'; properties: TemplateOutput };
}

// ─── Template Definitions ────────────────────────────────────────────────────

const templates: TemplateDef[] = [
	// ── Phase 1: SME Starter Pack (featured) ──────────────────────────────────

	{
		name: 'Investment Payback Calculator',
		description: 'Calculate payback period, ROI and total return for any investment or tool purchase.',
		icon: 'savings',
		industry: 'general',
		featured: true,
		sort: 1,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Investment', 10000],
				['Monthly Savings', 2000],
				['Monthly Costs', 500],
				['Discount Rate (%)', 5],
				['Horizon (months)', 60],
			],
			Calculations: [
				['Metric', 'Value'],
				['Net Monthly Benefit', 0],
				['Payback Months', 0],
				['Total Return', 0],
				['ROI %', 0],
			],
			Data: [
				['Notes'],
				['Discount rate is annual, converted to monthly for NPV.'],
				['Payback = Investment / Net Monthly Benefit (simple).'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B3-Parameters!B4',
				B3: '=IF(B2>0,CEILING(Parameters!B2/B2,1),0)',
				B4: '=(B2*Parameters!B6)-Parameters!B2',
				B5: '=IF(Parameters!B2>0,(B4/Parameters!B2)*100,0)',
			},
		},
		input: {
			type: 'object',
			properties: {
				investment: { mapping: 'Parameters!B2', title: 'Investment Amount', type: 'number', default: 10000, minimum: 0, order: 1 },
				monthly_savings: { mapping: 'Parameters!B3', title: 'Monthly Savings', type: 'number', default: 2000, minimum: 0, order: 2 },
				monthly_costs: { mapping: 'Parameters!B4', title: 'Monthly Costs', type: 'number', default: 500, minimum: 0, order: 3 },
				discount_rate: { mapping: 'Parameters!B5', title: 'Discount Rate', type: 'number', default: 5, minimum: 0, maximum: 100, transform: 'percentage', order: 4 },
				horizon: { mapping: 'Parameters!B6', title: 'Horizon (months)', type: 'integer', default: 60, minimum: 1, maximum: 360, order: 5 },
			},
		},
		output: {
			type: 'object',
			properties: {
				payback_months: { mapping: 'Calculations!B3', title: 'Payback Period (months)', type: 'number', order: 1 },
				net_monthly: { mapping: 'Calculations!B2', title: 'Net Monthly Benefit', type: 'number', order: 2 },
				total_return: { mapping: 'Calculations!B4', title: 'Total Return', type: 'number', order: 3 },
				roi_percent: { mapping: 'Calculations!B5', title: 'ROI', type: 'number', transform: 'percentage', order: 4 },
			},
		},
	},

	{
		name: 'True Cost of Manual Work',
		description: 'Quantify the real cost of manual processes including labour, errors and hidden overhead.',
		icon: 'precision_manufacturing',
		industry: 'general',
		featured: true,
		sort: 2,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Hours per Week', 20],
				['Hourly Rate', 35],
				['Error Rate (%)', 5],
				['Cost per Error', 200],
				['Tasks per Week', 100],
				['Weeks per Year', 48],
			],
			Calculations: [
				['Metric', 'Value'],
				['Annual Labour Cost', 0],
				['Annual Error Cost', 0],
				['Total Annual Cost', 0],
				['Cost per Task', 0],
			],
			Data: [
				['Notes'],
				['Error rate applied to tasks per week.'],
				['Cost per task = Total / (Tasks × Weeks).'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B2*Parameters!B3*Parameters!B7',
				B3: '=(Parameters!B4/100)*Parameters!B6*Parameters!B5*Parameters!B7',
				B4: '=B2+B3',
				B5: '=IF(Parameters!B6*Parameters!B7>0,B4/(Parameters!B6*Parameters!B7),0)',
			},
		},
		input: {
			type: 'object',
			properties: {
				hours_per_week: { mapping: 'Parameters!B2', title: 'Hours per Week', type: 'number', default: 20, minimum: 0, order: 1 },
				hourly_rate: { mapping: 'Parameters!B3', title: 'Hourly Rate', type: 'number', default: 35, minimum: 0, order: 2 },
				error_rate: { mapping: 'Parameters!B4', title: 'Error Rate', type: 'number', default: 5, minimum: 0, maximum: 100, transform: 'percentage', order: 3 },
				cost_per_error: { mapping: 'Parameters!B5', title: 'Cost per Error', type: 'number', default: 200, minimum: 0, order: 4 },
				tasks_per_week: { mapping: 'Parameters!B6', title: 'Tasks per Week', type: 'integer', default: 100, minimum: 1, order: 5 },
				weeks_per_year: { mapping: 'Parameters!B7', title: 'Weeks per Year', type: 'integer', default: 48, minimum: 1, maximum: 52, order: 6 },
			},
		},
		output: {
			type: 'object',
			properties: {
				annual_labour: { mapping: 'Calculations!B2', title: 'Annual Labour Cost', type: 'number', order: 1 },
				annual_errors: { mapping: 'Calculations!B3', title: 'Annual Error Cost', type: 'number', order: 2 },
				total_cost: { mapping: 'Calculations!B4', title: 'Total Annual Cost', type: 'number', order: 3 },
				cost_per_task: { mapping: 'Calculations!B5', title: 'Cost per Task', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Project Profitability',
		description: 'Analyse project margins with material, labour and overhead costs for construction and services.',
		icon: 'trending_up',
		industry: 'construction',
		featured: true,
		sort: 3,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Revenue', 50000],
				['Material Cost', 15000],
				['Labour Hours', 200],
				['Hourly Rate', 45],
				['Overhead (%)', 15],
				['Contingency (%)', 10],
			],
			Calculations: [
				['Metric', 'Value'],
				['Labour Cost', 0],
				['Overhead Amount', 0],
				['Contingency Amount', 0],
				['Total Cost', 0],
				['Gross Profit', 0],
				['Profit Margin %', 0],
			],
			Data: [
				['Notes'],
				['Overhead applied to material + labour subtotal.'],
				['Contingency applied after overhead.'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B4*Parameters!B5',
				B3: '=(Parameters!B3+B2)*(Parameters!B6/100)',
				B4: '=(Parameters!B3+B2+B3)*(Parameters!B7/100)',
				B5: '=Parameters!B3+B2+B3+B4',
				B6: '=Parameters!B2-B5',
				B7: '=IF(Parameters!B2>0,(B6/Parameters!B2)*100,0)',
			},
		},
		input: {
			type: 'object',
			properties: {
				revenue: { mapping: 'Parameters!B2', title: 'Project Revenue', type: 'number', default: 50000, minimum: 0, order: 1 },
				material_cost: { mapping: 'Parameters!B3', title: 'Material Cost', type: 'number', default: 15000, minimum: 0, order: 2 },
				labour_hours: { mapping: 'Parameters!B4', title: 'Labour Hours', type: 'number', default: 200, minimum: 0, order: 3 },
				hourly_rate: { mapping: 'Parameters!B5', title: 'Hourly Rate', type: 'number', default: 45, minimum: 0, order: 4 },
				overhead_pct: { mapping: 'Parameters!B6', title: 'Overhead', type: 'number', default: 15, minimum: 0, maximum: 100, transform: 'percentage', order: 5 },
				contingency_pct: { mapping: 'Parameters!B7', title: 'Contingency', type: 'number', default: 10, minimum: 0, maximum: 100, transform: 'percentage', order: 6 },
			},
		},
		output: {
			type: 'object',
			properties: {
				total_cost: { mapping: 'Calculations!B5', title: 'Total Cost', type: 'number', order: 1 },
				gross_profit: { mapping: 'Calculations!B6', title: 'Gross Profit', type: 'number', order: 2 },
				margin_pct: { mapping: 'Calculations!B7', title: 'Profit Margin', type: 'number', transform: 'percentage', order: 3 },
				labour_cost: { mapping: 'Calculations!B2', title: 'Labour Cost', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Project Cost Estimator',
		description: 'Build detailed project estimates with material, labour, equipment, subcontractors and markup.',
		icon: 'request_quote',
		industry: 'construction',
		featured: true,
		sort: 4,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Material Cost', 25000],
				['Labour Hours', 300],
				['Hourly Rate', 45],
				['Equipment Cost', 5000],
				['Subcontractor Cost', 10000],
				['Overhead (%)', 12],
				['Markup (%)', 20],
			],
			Calculations: [
				['Metric', 'Value'],
				['Labour Cost', 0],
				['Subtotal', 0],
				['Overhead Amount', 0],
				['Markup Amount', 0],
				['Total Estimate', 0],
			],
			Data: [
				['Cost Category', 'Typical Range (%)'],
				['Materials', '30-50'],
				['Labour', '25-40'],
				['Equipment', '5-15'],
				['Subcontractors', '10-30'],
				['Overhead', '8-20'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B3*Parameters!B4',
				B3: '=Parameters!B2+B2+Parameters!B5+Parameters!B6',
				B4: '=B3*(Parameters!B7/100)',
				B5: '=(B3+B4)*(Parameters!B8/100)',
				B6: '=B3+B4+B5',
			},
		},
		input: {
			type: 'object',
			properties: {
				material_cost: { mapping: 'Parameters!B2', title: 'Material Cost', type: 'number', default: 25000, minimum: 0, order: 1 },
				labour_hours: { mapping: 'Parameters!B3', title: 'Labour Hours', type: 'number', default: 300, minimum: 0, order: 2 },
				hourly_rate: { mapping: 'Parameters!B4', title: 'Hourly Rate', type: 'number', default: 45, minimum: 0, order: 3 },
				equipment_cost: { mapping: 'Parameters!B5', title: 'Equipment Cost', type: 'number', default: 5000, minimum: 0, order: 4 },
				subcontractor_cost: { mapping: 'Parameters!B6', title: 'Subcontractor Cost', type: 'number', default: 10000, minimum: 0, order: 5 },
				overhead_pct: { mapping: 'Parameters!B7', title: 'Overhead', type: 'number', default: 12, minimum: 0, maximum: 100, transform: 'percentage', order: 6 },
				markup_pct: { mapping: 'Parameters!B8', title: 'Markup', type: 'number', default: 20, minimum: 0, maximum: 100, transform: 'percentage', order: 7 },
			},
		},
		output: {
			type: 'object',
			properties: {
				subtotal: { mapping: 'Calculations!B3', title: 'Subtotal', type: 'number', order: 1 },
				overhead_amount: { mapping: 'Calculations!B4', title: 'Overhead', type: 'number', order: 2 },
				markup_amount: { mapping: 'Calculations!B5', title: 'Markup', type: 'number', order: 3 },
				total_estimate: { mapping: 'Calculations!B6', title: 'Total Estimate', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Downtime Cost Calculator',
		description: 'Calculate the true cost of production downtime including lost revenue and labour waste.',
		icon: 'report_problem',
		industry: 'manufacturing',
		featured: true,
		sort: 5,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Revenue per Hour', 5000],
				['Downtime Hours per Incident', 4],
				['Incidents per Year', 12],
				['Affected Employees', 10],
				['Employee Hourly Wage', 25],
			],
			Calculations: [
				['Metric', 'Value'],
				['Lost Revenue per Incident', 0],
				['Labour Cost per Incident', 0],
				['Total Downtime Hours', 0],
				['Annual Lost Revenue', 0],
				['Annual Labour Waste', 0],
				['Total Annual Cost', 0],
			],
			Data: [
				['Industry Benchmark', 'Avg Downtime Cost/hr'],
				['Automotive', '$22,000'],
				['Food & Beverage', '$30,000'],
				['Pharmaceutical', '$50,000'],
				['General Manufacturing', '$10,000'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B2*Parameters!B3',
				B3: '=Parameters!B4*Parameters!B5*Parameters!B6',
				B4: '=Parameters!B3*Parameters!B4',
				B5: '=B2*Parameters!B4',
				B6: '=B3',
				B7: '=B5+B6',
			},
		},
		input: {
			type: 'object',
			properties: {
				revenue_per_hour: { mapping: 'Parameters!B2', title: 'Revenue per Hour', type: 'number', default: 5000, minimum: 0, order: 1 },
				downtime_hours: { mapping: 'Parameters!B3', title: 'Downtime Hours per Incident', type: 'number', default: 4, minimum: 0, order: 2 },
				incidents_per_year: { mapping: 'Parameters!B4', title: 'Incidents per Year', type: 'integer', default: 12, minimum: 0, order: 3 },
				affected_employees: { mapping: 'Parameters!B5', title: 'Affected Employees', type: 'integer', default: 10, minimum: 1, order: 4 },
				hourly_wage: { mapping: 'Parameters!B6', title: 'Employee Hourly Wage', type: 'number', default: 25, minimum: 0, order: 5 },
			},
		},
		output: {
			type: 'object',
			properties: {
				annual_lost_revenue: { mapping: 'Calculations!B5', title: 'Annual Lost Revenue', type: 'number', order: 1 },
				annual_labour_waste: { mapping: 'Calculations!B6', title: 'Annual Labour Waste', type: 'number', order: 2 },
				total_annual_cost: { mapping: 'Calculations!B7', title: 'Total Annual Cost', type: 'number', order: 3 },
				total_downtime_hours: { mapping: 'Calculations!B4', title: 'Total Downtime Hours', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Employee True Cost',
		description: 'Calculate the full cost of employment beyond salary — tax, pension, insurance, training and more.',
		icon: 'badge',
		industry: 'hr',
		featured: true,
		sort: 6,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Annual Salary', 50000],
				['Employer Tax (%)', 13.8],
				['Pension Contribution (%)', 5],
				['Insurance (annual)', 1500],
				['Training (annual)', 2000],
				['Equipment (annual)', 1500],
				['Office/Desk Cost (annual)', 6000],
			],
			Calculations: [
				['Metric', 'Value'],
				['Tax Amount', 0],
				['Pension Amount', 0],
				['Benefits Total', 0],
				['Total Annual Cost', 0],
				['Monthly Cost', 0],
				['Cost Multiplier', 0],
				['Effective Hourly Rate', 0],
			],
			Data: [
				['Country', 'Typical Employer Tax %'],
				['UK', '13.8'],
				['US', '7.65'],
				['Germany', '20.7'],
				['France', '25-42'],
				['Australia', '11.5'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B2*(Parameters!B3/100)',
				B3: '=Parameters!B2*(Parameters!B4/100)',
				B4: '=Parameters!B5+Parameters!B6+Parameters!B7+Parameters!B8',
				B5: '=Parameters!B2+B2+B3+B4',
				B6: '=B5/12',
				B7: '=IF(Parameters!B2>0,B5/Parameters!B2,0)',
				B8: '=IF(1950>0,B5/1950,0)',
			},
		},
		input: {
			type: 'object',
			properties: {
				salary: { mapping: 'Parameters!B2', title: 'Annual Salary', type: 'number', default: 50000, minimum: 0, order: 1 },
				tax_pct: { mapping: 'Parameters!B3', title: 'Employer Tax', type: 'number', default: 13.8, minimum: 0, maximum: 100, transform: 'percentage', order: 2 },
				pension_pct: { mapping: 'Parameters!B4', title: 'Pension Contribution', type: 'number', default: 5, minimum: 0, maximum: 100, transform: 'percentage', order: 3 },
				insurance: { mapping: 'Parameters!B5', title: 'Insurance (annual)', type: 'number', default: 1500, minimum: 0, order: 4 },
				training: { mapping: 'Parameters!B6', title: 'Training (annual)', type: 'number', default: 2000, minimum: 0, order: 5 },
				equipment: { mapping: 'Parameters!B7', title: 'Equipment (annual)', type: 'number', default: 1500, minimum: 0, order: 6 },
				office_cost: { mapping: 'Parameters!B8', title: 'Office/Desk Cost (annual)', type: 'number', default: 6000, minimum: 0, order: 7 },
			},
		},
		output: {
			type: 'object',
			properties: {
				total_annual: { mapping: 'Calculations!B5', title: 'Total Annual Cost', type: 'number', order: 1 },
				monthly_cost: { mapping: 'Calculations!B6', title: 'Monthly Cost', type: 'number', order: 2 },
				cost_multiplier: { mapping: 'Calculations!B7', title: 'Cost Multiplier', type: 'number', order: 3 },
				hourly_rate: { mapping: 'Calculations!B8', title: 'Effective Hourly Rate', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Break-even Calculator',
		description: 'Find the exact number of units needed to cover costs and reach your profit target.',
		icon: 'balance',
		industry: 'finance',
		featured: true,
		sort: 7,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Fixed Costs', 10000],
				['Price per Unit', 50],
				['Variable Cost per Unit', 20],
				['Target Profit', 5000],
			],
			Calculations: [
				['Metric', 'Value'],
				['Contribution Margin', 0],
				['Break-even Units', 0],
				['Break-even Revenue', 0],
				['Units for Target Profit', 0],
			],
			Data: [
				['Notes'],
				['Contribution Margin = Price - Variable Cost.'],
				['Break-even = Fixed Costs / Contribution Margin.'],
				['Target units include desired profit.'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B3-Parameters!B4',
				B3: '=IF(B2>0,CEILING(Parameters!B2/B2,1),0)',
				B4: '=B3*Parameters!B3',
				B5: '=IF(B2>0,CEILING((Parameters!B2+Parameters!B5)/B2,1),0)',
			},
		},
		input: {
			type: 'object',
			properties: {
				fixed_costs: { mapping: 'Parameters!B2', title: 'Fixed Costs', type: 'number', default: 10000, minimum: 0, order: 1 },
				price_per_unit: { mapping: 'Parameters!B3', title: 'Price per Unit', type: 'number', default: 50, minimum: 0, order: 2 },
				variable_cost: { mapping: 'Parameters!B4', title: 'Variable Cost per Unit', type: 'number', default: 20, minimum: 0, order: 3 },
				target_profit: { mapping: 'Parameters!B5', title: 'Target Profit', type: 'number', default: 5000, minimum: 0, order: 4 },
			},
		},
		output: {
			type: 'object',
			properties: {
				break_even_units: { mapping: 'Calculations!B3', title: 'Break-even Units', type: 'number', order: 1 },
				break_even_revenue: { mapping: 'Calculations!B4', title: 'Break-even Revenue', type: 'number', order: 2 },
				contribution_margin: { mapping: 'Calculations!B2', title: 'Contribution Margin', type: 'number', order: 3 },
				units_for_target: { mapping: 'Calculations!B5', title: 'Units for Target Profit', type: 'number', order: 4 },
			},
		},
	},

	// ── Phase 2: SEO Magnets ──────────────────────────────────────────────────

	{
		name: 'Profit Margin Calculator',
		description: 'Calculate gross, net and operating profit margins from revenue and costs.',
		icon: 'percent',
		industry: 'finance',
		featured: false,
		sort: 8,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Revenue', 100000],
				['Cost of Goods Sold', 60000],
				['Operating Expenses', 20000],
				['Tax Rate (%)', 20],
			],
			Calculations: [
				['Metric', 'Value'],
				['Gross Profit', 0],
				['Gross Margin %', 0],
				['Operating Profit', 0],
				['Operating Margin %', 0],
				['Tax Amount', 0],
				['Net Profit', 0],
				['Net Margin %', 0],
			],
			Data: [
				['Industry', 'Avg Gross Margin'],
				['Retail', '25-35%'],
				['Software/SaaS', '70-85%'],
				['Manufacturing', '25-35%'],
				['Services', '50-70%'],
				['Construction', '15-25%'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B2-Parameters!B3',
				B3: '=IF(Parameters!B2>0,(B2/Parameters!B2)*100,0)',
				B4: '=B2-Parameters!B4',
				B5: '=IF(Parameters!B2>0,(B4/Parameters!B2)*100,0)',
				B6: '=B4*(Parameters!B5/100)',
				B7: '=B4-B6',
				B8: '=IF(Parameters!B2>0,(B7/Parameters!B2)*100,0)',
			},
		},
		input: {
			type: 'object',
			properties: {
				revenue: { mapping: 'Parameters!B2', title: 'Revenue', type: 'number', default: 100000, minimum: 0, order: 1 },
				cogs: { mapping: 'Parameters!B3', title: 'Cost of Goods Sold', type: 'number', default: 60000, minimum: 0, order: 2 },
				operating_expenses: { mapping: 'Parameters!B4', title: 'Operating Expenses', type: 'number', default: 20000, minimum: 0, order: 3 },
				tax_rate: { mapping: 'Parameters!B5', title: 'Tax Rate', type: 'number', default: 20, minimum: 0, maximum: 100, transform: 'percentage', order: 4 },
			},
		},
		output: {
			type: 'object',
			properties: {
				gross_profit: { mapping: 'Calculations!B2', title: 'Gross Profit', type: 'number', order: 1 },
				gross_margin: { mapping: 'Calculations!B3', title: 'Gross Margin', type: 'number', transform: 'percentage', order: 2 },
				net_profit: { mapping: 'Calculations!B7', title: 'Net Profit', type: 'number', order: 3 },
				net_margin: { mapping: 'Calculations!B8', title: 'Net Margin', type: 'number', transform: 'percentage', order: 4 },
			},
		},
	},

	{
		name: 'VAT / Tax Calculator',
		description: 'Calculate VAT-inclusive and VAT-exclusive prices with any tax rate.',
		icon: 'receipt_long',
		industry: 'finance',
		featured: false,
		sort: 9,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Net Amount', 1000],
				['VAT Rate (%)', 20],
			],
			Calculations: [
				['Metric', 'Value'],
				['VAT Amount', 0],
				['Gross Amount (inc. VAT)', 0],
				['Net from Gross', 0],
				['VAT from Gross', 0],
			],
			Data: [
				['Country', 'Standard VAT Rate'],
				['UK', '20%'],
				['Germany', '19%'],
				['France', '20%'],
				['Netherlands', '21%'],
				['US (Sales Tax)', '0-10%'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B2*(Parameters!B3/100)',
				B3: '=Parameters!B2+B2',
				B4: '=B3/(1+Parameters!B3/100)',
				B5: '=B3-B4',
			},
		},
		input: {
			type: 'object',
			properties: {
				net_amount: { mapping: 'Parameters!B2', title: 'Net Amount (excl. VAT)', type: 'number', default: 1000, minimum: 0, order: 1 },
				vat_rate: { mapping: 'Parameters!B3', title: 'VAT Rate', type: 'number', default: 20, minimum: 0, maximum: 100, transform: 'percentage', order: 2 },
			},
		},
		output: {
			type: 'object',
			properties: {
				vat_amount: { mapping: 'Calculations!B2', title: 'VAT Amount', type: 'number', order: 1 },
				gross_amount: { mapping: 'Calculations!B3', title: 'Gross Amount (inc. VAT)', type: 'number', order: 2 },
				net_from_gross: { mapping: 'Calculations!B4', title: 'Net from Gross', type: 'number', order: 3 },
				vat_from_gross: { mapping: 'Calculations!B5', title: 'VAT from Gross', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Mortgage Calculator',
		description: 'Calculate monthly repayments, total interest and cost for any mortgage or loan.',
		icon: 'home',
		industry: 'real-estate',
		featured: false,
		sort: 10,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Property Price', 300000],
				['Deposit (%)', 20],
				['Annual Interest Rate (%)', 4.5],
				['Term (years)', 25],
			],
			Calculations: [
				['Metric', 'Value'],
				['Loan Amount', 0],
				['Monthly Rate', 0],
				['Num Payments', 0],
				['Monthly Payment', 0],
				['Total Repaid', 0],
				['Total Interest', 0],
			],
			Data: [
				['Term', 'Typical Rate Range'],
				['2-year fixed', '3.5-5.5%'],
				['5-year fixed', '4.0-5.5%'],
				['10-year fixed', '4.5-6.0%'],
				['Variable', '4.0-6.5%'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B2*(1-Parameters!B3/100)',
				B3: '=(Parameters!B4/100)/12',
				B4: '=Parameters!B5*12',
				B5: '=IF(B3>0,B2*(B3*POWER(1+B3,B4))/(POWER(1+B3,B4)-1),B2/B4)',
				B6: '=B5*B4',
				B7: '=B6-B2',
			},
		},
		input: {
			type: 'object',
			properties: {
				property_price: { mapping: 'Parameters!B2', title: 'Property Price', type: 'number', default: 300000, minimum: 0, order: 1 },
				deposit_pct: { mapping: 'Parameters!B3', title: 'Deposit', type: 'number', default: 20, minimum: 0, maximum: 100, transform: 'percentage', order: 2 },
				interest_rate: { mapping: 'Parameters!B4', title: 'Annual Interest Rate', type: 'number', default: 4.5, minimum: 0, maximum: 100, transform: 'percentage', order: 3 },
				term_years: { mapping: 'Parameters!B5', title: 'Term (years)', type: 'integer', default: 25, minimum: 1, maximum: 50, order: 4 },
			},
		},
		output: {
			type: 'object',
			properties: {
				monthly_payment: { mapping: 'Calculations!B5', title: 'Monthly Payment', type: 'number', order: 1 },
				loan_amount: { mapping: 'Calculations!B2', title: 'Loan Amount', type: 'number', order: 2 },
				total_interest: { mapping: 'Calculations!B7', title: 'Total Interest', type: 'number', order: 3 },
				total_repaid: { mapping: 'Calculations!B6', title: 'Total Repaid', type: 'number', order: 4 },
			},
		},
	},

	// ── Phase 3: High-Value ───────────────────────────────────────────────────

	{
		name: 'ROI Calculator',
		description: 'Calculate return on investment with initial cost, gains and time period.',
		icon: 'show_chart',
		industry: 'general',
		featured: false,
		sort: 11,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Initial Investment', 50000],
				['Final Value', 75000],
				['Annual Revenue', 20000],
				['Annual Costs', 5000],
				['Time Period (years)', 3],
			],
			Calculations: [
				['Metric', 'Value'],
				['Total Gain', 0],
				['Net Profit', 0],
				['ROI %', 0],
				['Annualised ROI %', 0],
				['Payback Period (years)', 0],
			],
			Data: [
				['Investment Type', 'Typical ROI Range'],
				['Stock Market', '7-10% p.a.'],
				['Real Estate', '8-12% p.a.'],
				['Business Investment', '15-30%'],
				['Marketing', '5:1 ratio'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B3-Parameters!B2',
				B3: '=(Parameters!B4-Parameters!B5)*Parameters!B6+B2',
				B4: '=IF(Parameters!B2>0,(B3/Parameters!B2)*100,0)',
				B5: '=IF(Parameters!B6>0,B4/Parameters!B6,0)',
				B6: '=IF((Parameters!B4-Parameters!B5)>0,Parameters!B2/(Parameters!B4-Parameters!B5),0)',
			},
		},
		input: {
			type: 'object',
			properties: {
				initial_investment: { mapping: 'Parameters!B2', title: 'Initial Investment', type: 'number', default: 50000, minimum: 0, order: 1 },
				final_value: { mapping: 'Parameters!B3', title: 'Final Value', type: 'number', default: 75000, minimum: 0, order: 2 },
				annual_revenue: { mapping: 'Parameters!B4', title: 'Annual Revenue', type: 'number', default: 20000, minimum: 0, order: 3 },
				annual_costs: { mapping: 'Parameters!B5', title: 'Annual Costs', type: 'number', default: 5000, minimum: 0, order: 4 },
				time_period: { mapping: 'Parameters!B6', title: 'Time Period (years)', type: 'integer', default: 3, minimum: 1, order: 5 },
			},
		},
		output: {
			type: 'object',
			properties: {
				roi_pct: { mapping: 'Calculations!B4', title: 'ROI', type: 'number', transform: 'percentage', order: 1 },
				net_profit: { mapping: 'Calculations!B3', title: 'Net Profit', type: 'number', order: 2 },
				annualised_roi: { mapping: 'Calculations!B5', title: 'Annualised ROI', type: 'number', transform: 'percentage', order: 3 },
				payback_years: { mapping: 'Calculations!B6', title: 'Payback Period (years)', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Cost Savings Calculator',
		description: 'Compare current vs proposed costs to quantify savings from process changes or new tools.',
		icon: 'money_off',
		industry: 'general',
		featured: false,
		sort: 12,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Current Monthly Cost', 15000],
				['Proposed Monthly Cost', 8000],
				['Implementation Cost', 20000],
				['Time Period (months)', 24],
			],
			Calculations: [
				['Metric', 'Value'],
				['Monthly Savings', 0],
				['Annual Savings', 0],
				['Total Savings (period)', 0],
				['Net Savings (after impl.)', 0],
				['Payback Months', 0],
				['Savings %', 0],
			],
			Data: [
				['Notes'],
				['Net savings = total savings - implementation cost.'],
				['Payback = implementation cost / monthly savings.'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B2-Parameters!B3',
				B3: '=B2*12',
				B4: '=B2*Parameters!B5',
				B5: '=B4-Parameters!B4',
				B6: '=IF(B2>0,CEILING(Parameters!B4/B2,1),0)',
				B7: '=IF(Parameters!B2>0,(B2/Parameters!B2)*100,0)',
			},
		},
		input: {
			type: 'object',
			properties: {
				current_cost: { mapping: 'Parameters!B2', title: 'Current Monthly Cost', type: 'number', default: 15000, minimum: 0, order: 1 },
				proposed_cost: { mapping: 'Parameters!B3', title: 'Proposed Monthly Cost', type: 'number', default: 8000, minimum: 0, order: 2 },
				implementation_cost: { mapping: 'Parameters!B4', title: 'Implementation Cost', type: 'number', default: 20000, minimum: 0, order: 3 },
				time_period: { mapping: 'Parameters!B5', title: 'Time Period (months)', type: 'integer', default: 24, minimum: 1, order: 4 },
			},
		},
		output: {
			type: 'object',
			properties: {
				monthly_savings: { mapping: 'Calculations!B2', title: 'Monthly Savings', type: 'number', order: 1 },
				annual_savings: { mapping: 'Calculations!B3', title: 'Annual Savings', type: 'number', order: 2 },
				net_savings: { mapping: 'Calculations!B5', title: 'Net Savings', type: 'number', order: 3 },
				payback_months: { mapping: 'Calculations!B6', title: 'Payback Period (months)', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Pricing / Quote Calculator',
		description: 'Build service or product quotes with cost-plus pricing, discounts and tax.',
		icon: 'sell',
		industry: 'general',
		featured: false,
		sort: 13,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Base Cost', 5000],
				['Labour Hours', 40],
				['Hourly Rate', 75],
				['Margin (%)', 30],
				['Discount (%)', 10],
				['Tax Rate (%)', 20],
			],
			Calculations: [
				['Metric', 'Value'],
				['Labour Cost', 0],
				['Total Cost', 0],
				['Price (before discount)', 0],
				['Discount Amount', 0],
				['Subtotal', 0],
				['Tax Amount', 0],
				['Final Quote', 0],
			],
			Data: [
				['Notes'],
				['Margin applied to total cost to set price.'],
				['Discount applied to pre-discount price.'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B3*Parameters!B4',
				B3: '=Parameters!B2+B2',
				B4: '=B3*(1+Parameters!B5/100)',
				B5: '=B4*(Parameters!B6/100)',
				B6: '=B4-B5',
				B7: '=B6*(Parameters!B7/100)',
				B8: '=B6+B7',
			},
		},
		input: {
			type: 'object',
			properties: {
				base_cost: { mapping: 'Parameters!B2', title: 'Base Cost', type: 'number', default: 5000, minimum: 0, order: 1 },
				labour_hours: { mapping: 'Parameters!B3', title: 'Labour Hours', type: 'number', default: 40, minimum: 0, order: 2 },
				hourly_rate: { mapping: 'Parameters!B4', title: 'Hourly Rate', type: 'number', default: 75, minimum: 0, order: 3 },
				margin_pct: { mapping: 'Parameters!B5', title: 'Margin', type: 'number', default: 30, minimum: 0, maximum: 100, transform: 'percentage', order: 4 },
				discount_pct: { mapping: 'Parameters!B6', title: 'Discount', type: 'number', default: 10, minimum: 0, maximum: 100, transform: 'percentage', order: 5 },
				tax_rate: { mapping: 'Parameters!B7', title: 'Tax Rate', type: 'number', default: 20, minimum: 0, maximum: 100, transform: 'percentage', order: 6 },
			},
		},
		output: {
			type: 'object',
			properties: {
				total_cost: { mapping: 'Calculations!B3', title: 'Total Cost', type: 'number', order: 1 },
				subtotal: { mapping: 'Calculations!B6', title: 'Subtotal (after discount)', type: 'number', order: 2 },
				tax_amount: { mapping: 'Calculations!B7', title: 'Tax Amount', type: 'number', order: 3 },
				final_quote: { mapping: 'Calculations!B8', title: 'Final Quote', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Marketing ROI Calculator',
		description: 'Measure marketing campaign effectiveness with spend, leads, conversions and revenue.',
		icon: 'campaign',
		industry: 'marketing',
		featured: false,
		sort: 14,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Marketing Spend', 10000],
				['Leads Generated', 500],
				['Conversion Rate (%)', 5],
				['Average Order Value', 200],
				['Customer Lifetime Value', 1000],
			],
			Calculations: [
				['Metric', 'Value'],
				['Customers Acquired', 0],
				['Revenue Generated', 0],
				['ROI %', 0],
				['Cost per Lead', 0],
				['Cost per Acquisition', 0],
				['Lifetime ROI %', 0],
			],
			Data: [
				['Channel', 'Typical CPA Range'],
				['Google Ads', '$30-100'],
				['Facebook Ads', '$15-60'],
				['Email Marketing', '$5-25'],
				['Content Marketing', '$10-50'],
				['SEO', '$20-80'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B3*(Parameters!B4/100)',
				B3: '=B2*Parameters!B5',
				B4: '=IF(Parameters!B2>0,((B3-Parameters!B2)/Parameters!B2)*100,0)',
				B5: '=IF(Parameters!B3>0,Parameters!B2/Parameters!B3,0)',
				B6: '=IF(B2>0,Parameters!B2/B2,0)',
				B7: '=IF(Parameters!B2>0,((B2*Parameters!B6-Parameters!B2)/Parameters!B2)*100,0)',
			},
		},
		input: {
			type: 'object',
			properties: {
				marketing_spend: { mapping: 'Parameters!B2', title: 'Marketing Spend', type: 'number', default: 10000, minimum: 0, order: 1 },
				leads: { mapping: 'Parameters!B3', title: 'Leads Generated', type: 'integer', default: 500, minimum: 0, order: 2 },
				conversion_rate: { mapping: 'Parameters!B4', title: 'Conversion Rate', type: 'number', default: 5, minimum: 0, maximum: 100, transform: 'percentage', order: 3 },
				avg_order_value: { mapping: 'Parameters!B5', title: 'Average Order Value', type: 'number', default: 200, minimum: 0, order: 4 },
				lifetime_value: { mapping: 'Parameters!B6', title: 'Customer Lifetime Value', type: 'number', default: 1000, minimum: 0, order: 5 },
			},
		},
		output: {
			type: 'object',
			properties: {
				roi_pct: { mapping: 'Calculations!B4', title: 'Campaign ROI', type: 'number', transform: 'percentage', order: 1 },
				customers: { mapping: 'Calculations!B2', title: 'Customers Acquired', type: 'number', order: 2 },
				cost_per_lead: { mapping: 'Calculations!B5', title: 'Cost per Lead', type: 'number', order: 3 },
				cost_per_acquisition: { mapping: 'Calculations!B6', title: 'Cost per Acquisition', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Energy Savings Calculator',
		description: 'Compare energy costs before and after efficiency upgrades with payback analysis.',
		icon: 'bolt',
		industry: 'energy',
		featured: false,
		sort: 15,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Current Annual Energy Cost', 24000],
				['Expected Savings (%)', 30],
				['Upgrade Cost', 15000],
				['Energy Price Increase (%/yr)', 5],
				['Analysis Period (years)', 10],
			],
			Calculations: [
				['Metric', 'Value'],
				['Annual Savings', 0],
				['Payback Period (years)', 0],
				['10-Year Total Savings', 0],
				['Net Savings (after upgrade)', 0],
				['New Annual Cost', 0],
			],
			Data: [
				['Upgrade Type', 'Typical Savings %'],
				['LED Lighting', '50-70%'],
				['HVAC Upgrade', '20-40%'],
				['Insulation', '10-25%'],
				['Solar Panels', '40-70%'],
				['Smart Controls', '10-30%'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B2*(Parameters!B3/100)',
				B3: '=IF(B2>0,Parameters!B4/B2,0)',
				B4: '=B2*Parameters!B6',
				B5: '=B4-Parameters!B4',
				B6: '=Parameters!B2-B2',
			},
		},
		input: {
			type: 'object',
			properties: {
				current_energy_cost: { mapping: 'Parameters!B2', title: 'Current Annual Energy Cost', type: 'number', default: 24000, minimum: 0, order: 1 },
				savings_pct: { mapping: 'Parameters!B3', title: 'Expected Savings', type: 'number', default: 30, minimum: 0, maximum: 100, transform: 'percentage', order: 2 },
				upgrade_cost: { mapping: 'Parameters!B4', title: 'Upgrade Cost', type: 'number', default: 15000, minimum: 0, order: 3 },
				price_increase: { mapping: 'Parameters!B5', title: 'Energy Price Increase (%/yr)', type: 'number', default: 5, minimum: 0, maximum: 100, transform: 'percentage', order: 4 },
				analysis_period: { mapping: 'Parameters!B6', title: 'Analysis Period (years)', type: 'integer', default: 10, minimum: 1, maximum: 30, order: 5 },
			},
		},
		output: {
			type: 'object',
			properties: {
				annual_savings: { mapping: 'Calculations!B2', title: 'Annual Savings', type: 'number', order: 1 },
				payback_years: { mapping: 'Calculations!B3', title: 'Payback Period (years)', type: 'number', order: 2 },
				total_savings: { mapping: 'Calculations!B4', title: 'Total Savings (period)', type: 'number', order: 3 },
				net_savings: { mapping: 'Calculations!B5', title: 'Net Savings', type: 'number', order: 4 },
			},
		},
	},

	{
		name: 'Solar ROI Calculator',
		description: 'Estimate solar panel savings, payback period and lifetime return on investment.',
		icon: 'solar_power',
		industry: 'energy',
		featured: false,
		sort: 16,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['System Cost', 12000],
				['Annual Energy Production (kWh)', 4000],
				['Electricity Rate (per kWh)', 0.30],
				['Annual Rate Increase (%)', 5],
				['System Lifespan (years)', 25],
				['Annual Maintenance', 200],
			],
			Calculations: [
				['Metric', 'Value'],
				['Annual Savings (Year 1)', 0],
				['Net Annual Savings', 0],
				['Payback Period (years)', 0],
				['25-Year Total Savings', 0],
				['Lifetime ROI %', 0],
			],
			Data: [
				['Region', 'Avg kWh/kW/year'],
				['Southern Europe', '1400-1800'],
				['Northern Europe', '800-1100'],
				['US Southwest', '1600-2000'],
				['US Northeast', '1000-1300'],
				['Australia', '1400-1900'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B3*Parameters!B4',
				B3: '=B2-Parameters!B7',
				B4: '=IF(B3>0,Parameters!B2/B3,0)',
				B5: '=B3*Parameters!B6',
				B6: '=IF(Parameters!B2>0,(B5/Parameters!B2)*100,0)',
			},
		},
		input: {
			type: 'object',
			properties: {
				system_cost: { mapping: 'Parameters!B2', title: 'System Cost', type: 'number', default: 12000, minimum: 0, order: 1 },
				annual_production: { mapping: 'Parameters!B3', title: 'Annual Energy Production (kWh)', type: 'number', default: 4000, minimum: 0, order: 2 },
				electricity_rate: { mapping: 'Parameters!B4', title: 'Electricity Rate (per kWh)', type: 'number', default: 0.30, minimum: 0, order: 3 },
				rate_increase: { mapping: 'Parameters!B5', title: 'Annual Rate Increase', type: 'number', default: 5, minimum: 0, maximum: 100, transform: 'percentage', order: 4 },
				lifespan: { mapping: 'Parameters!B6', title: 'System Lifespan (years)', type: 'integer', default: 25, minimum: 1, maximum: 40, order: 5 },
				maintenance: { mapping: 'Parameters!B7', title: 'Annual Maintenance', type: 'number', default: 200, minimum: 0, order: 6 },
			},
		},
		output: {
			type: 'object',
			properties: {
				annual_savings: { mapping: 'Calculations!B2', title: 'Annual Savings (Year 1)', type: 'number', order: 1 },
				payback_years: { mapping: 'Calculations!B4', title: 'Payback Period (years)', type: 'number', order: 2 },
				lifetime_savings: { mapping: 'Calculations!B5', title: 'Lifetime Savings', type: 'number', order: 3 },
				lifetime_roi: { mapping: 'Calculations!B6', title: 'Lifetime ROI', type: 'number', transform: 'percentage', order: 4 },
			},
		},
	},

	{
		name: 'Rental Yield Calculator',
		description: 'Calculate gross and net rental yield, monthly cash flow and annual return.',
		icon: 'apartment',
		industry: 'real-estate',
		featured: false,
		sort: 17,
		sheets: {
			Parameters: [
				['Parameter', 'Value'],
				['Property Value', 250000],
				['Monthly Rent', 1200],
				['Annual Insurance', 1500],
				['Annual Maintenance', 2000],
				['Management Fee (%)', 10],
				['Vacancy Rate (%)', 5],
				['Annual Mortgage Payment', 12000],
			],
			Calculations: [
				['Metric', 'Value'],
				['Annual Gross Rent', 0],
				['Effective Rent (after vacancy)', 0],
				['Management Fee', 0],
				['Total Expenses', 0],
				['Net Operating Income', 0],
				['Gross Yield %', 0],
				['Net Yield %', 0],
				['Monthly Cash Flow', 0],
			],
			Data: [
				['Market', 'Typical Gross Yield'],
				['London', '3-5%'],
				['Manchester', '5-7%'],
				['Berlin', '3-4%'],
				['US Average', '6-8%'],
				['Australia', '3-5%'],
			],
		},
		formulas: {
			Calculations: {
				B2: '=Parameters!B3*12',
				B3: '=B2*(1-Parameters!B7/100)',
				B4: '=B3*(Parameters!B6/100)',
				B5: '=Parameters!B4+Parameters!B5+B4',
				B6: '=B3-B5',
				B7: '=IF(Parameters!B2>0,(B2/Parameters!B2)*100,0)',
				B8: '=IF(Parameters!B2>0,(B6/Parameters!B2)*100,0)',
				B9: '=(B6-Parameters!B8)/12',
			},
		},
		input: {
			type: 'object',
			properties: {
				property_value: { mapping: 'Parameters!B2', title: 'Property Value', type: 'number', default: 250000, minimum: 0, order: 1 },
				monthly_rent: { mapping: 'Parameters!B3', title: 'Monthly Rent', type: 'number', default: 1200, minimum: 0, order: 2 },
				insurance: { mapping: 'Parameters!B4', title: 'Annual Insurance', type: 'number', default: 1500, minimum: 0, order: 3 },
				maintenance: { mapping: 'Parameters!B5', title: 'Annual Maintenance', type: 'number', default: 2000, minimum: 0, order: 4 },
				management_fee: { mapping: 'Parameters!B6', title: 'Management Fee', type: 'number', default: 10, minimum: 0, maximum: 100, transform: 'percentage', order: 5 },
				vacancy_rate: { mapping: 'Parameters!B7', title: 'Vacancy Rate', type: 'number', default: 5, minimum: 0, maximum: 100, transform: 'percentage', order: 6 },
				mortgage_payment: { mapping: 'Parameters!B8', title: 'Annual Mortgage Payment', type: 'number', default: 12000, minimum: 0, order: 7 },
			},
		},
		output: {
			type: 'object',
			properties: {
				gross_yield: { mapping: 'Calculations!B7', title: 'Gross Yield', type: 'number', transform: 'percentage', order: 1 },
				net_yield: { mapping: 'Calculations!B8', title: 'Net Yield', type: 'number', transform: 'percentage', order: 2 },
				net_income: { mapping: 'Calculations!B6', title: 'Net Operating Income', type: 'number', order: 3 },
				monthly_cash_flow: { mapping: 'Calculations!B9', title: 'Monthly Cash Flow', type: 'number', order: 4 },
			},
		},
	},
];

// ─── Excel Generator ─────────────────────────────────────────────────────────

async function generateExcel(tmpl: TemplateDef, outDir: string): Promise<string> {
	const wb = new ExcelJS.Workbook();

	for (const [sheetName, rows] of Object.entries(tmpl.sheets)) {
		const ws = wb.addWorksheet(sheetName);
		for (const row of rows) {
			ws.addRow(row);
		}
		// Apply formulas
		const sheetFormulas = tmpl.formulas[sheetName];
		if (sheetFormulas) {
			for (const [cellRef, formula] of Object.entries(sheetFormulas)) {
				const cell = ws.getCell(cellRef);
				cell.value = { formula: formula.startsWith('=') ? formula.slice(1) : formula } as any;
			}
		}
		// Bold header row
		const headerRow = ws.getRow(1);
		headerRow.font = { bold: true };
		// Auto-width columns
		ws.columns.forEach((col) => {
			col.width = 25;
		});
	}

	const slug = tmpl.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
	const filePath = join(outDir, `${slug}.xlsx`);
	await wb.xlsx.writeFile(filePath);
	return filePath;
}

// ─── SQL Generator ───────────────────────────────────────────────────────────

function escapeSQL(val: string): string {
	return val.replace(/'/g, "''");
}

function generateSQL(tmplDefs: TemplateDef[]): string {
	const lines: string[] = [
		'-- Auto-generated calculator templates seed',
		`-- Generated: ${new Date().toISOString()}`,
		'-- Run: cat seed-templates.sql | docker compose exec -T postgres psql -U directus -d directus',
		'',
		'BEGIN;',
		'',
		'-- Clear existing templates',
		'DELETE FROM calculator_templates;',
		'',
	];

	for (const tmpl of tmplDefs) {
		const id = randomUUID();
		const sheetsJson = escapeSQL(JSON.stringify(tmpl.sheets));
		const formulasJson = escapeSQL(JSON.stringify(tmpl.formulas));
		const inputJson = escapeSQL(JSON.stringify(tmpl.input));
		const outputJson = escapeSQL(JSON.stringify(tmpl.output));

		lines.push(`INSERT INTO calculator_templates (id, name, description, icon, sheets, formulas, input, output, sort, featured, industry) VALUES (`);
		lines.push(`  '${id}',`);
		lines.push(`  '${escapeSQL(tmpl.name)}',`);
		lines.push(`  '${escapeSQL(tmpl.description)}',`);
		lines.push(`  '${escapeSQL(tmpl.icon)}',`);
		lines.push(`  '${sheetsJson}',`);
		lines.push(`  '${formulasJson}',`);
		lines.push(`  '${inputJson}',`);
		lines.push(`  '${outputJson}',`);
		lines.push(`  ${tmpl.sort},`);
		lines.push(`  ${tmpl.featured},`);
		lines.push(`  '${escapeSQL(tmpl.industry)}'`);
		lines.push(`);`);
		lines.push('');
	}

	lines.push('COMMIT;');
	return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	const outDir = join(import.meta.dirname!, 'template-excels');
	mkdirSync(outDir, { recursive: true });

	console.log(`Generating ${templates.length} templates...`);

	// Generate Excel files
	for (const tmpl of templates) {
		const path = await generateExcel(tmpl, outDir);
		console.log(`  ✓ ${tmpl.name} → ${path}`);
	}

	// Generate SQL
	const sql = generateSQL(templates);
	const sqlPath = join(import.meta.dirname!, 'seed-templates.sql');
	writeFileSync(sqlPath, sql, 'utf-8');
	console.log(`\n  ✓ SQL → ${sqlPath}`);

	console.log(`\nDone! ${templates.length} templates generated.`);
	console.log('To seed: cat seed-templates.sql | docker compose exec -T postgres psql -U directus -d directus');
}

main().catch(console.error);
