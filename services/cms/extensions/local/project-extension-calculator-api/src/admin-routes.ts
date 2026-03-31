import { requireAuth, requireAdmin } from './auth.js';
import type { DB } from './types.js';

export function registerAdminRoutes(app: any, db: DB, logger: any) {

	// GET /calc/admin/overview — aggregated KPIs + chart data
	app.get('/calc/admin/overview', requireAuth, requireAdmin, async (_req: any, res: any) => {
		try {
			const now = new Date();
			const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
			const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
			const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
			const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30).toISOString();
			const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1).toISOString();

			// Subquery: non-admin account IDs (exempt_from_subscription = false)
			const customerFilter = (q: any) => q.where('exempt_from_subscription', false);

			const [
				accountCount,
				subsByPlan,
				calcTotal,
				calcActive,
				callsToday,
				callsWeek,
				callsMonth,
				errorsMonth,
				callsPerDay,
				accountsPerMonth,
				mrrResult,
				churnedResult,
				trialConversion,
				deletionsPerMonth,
				conversionsPerMonth,
			] = await Promise.all([
				db('account').where('exempt_from_subscription', false).count('* as count').first(),
				db('subscriptions as s')
					.join('subscription_plans as sp', 'sp.id', 's.plan')
					.join('account as a', 'a.id', 's.account')
					.where('a.exempt_from_subscription', false)
					.where('s.status', 'active')
					.groupBy('sp.name', 'sp.id')
					.select('sp.name as plan_name')
					.count('* as count'),
				db('calculators').count('* as count').first(),
				db('calculators').where('activated', true).count('* as count').first(),
				db('formula.calculator_calls').where('timestamp', '>=', todayStart).count('* as count').first(),
				db('formula.calculator_calls').where('timestamp', '>=', weekStart).count('* as count').first(),
				db('formula.calculator_calls').where('timestamp', '>=', monthStart).count('* as count').first(),
				db('formula.calculator_calls').where('timestamp', '>=', monthStart).where('error', true).count('* as count').first(),
				db('formula.calculator_calls')
					.where('timestamp', '>=', thirtyDaysAgo)
					.select(db.raw("DATE(timestamp) as date"))
					.count('* as total')
					.sum({ errors: db.raw("CASE WHEN error = true THEN 1 ELSE 0 END") })
					.groupBy(db.raw("DATE(timestamp)"))
					.orderBy('date', 'asc'),
				db('account')
					.where('date_created', '>=', twelveMonthsAgo)
					.where('exempt_from_subscription', false)
					.select(db.raw("TO_CHAR(date_created, 'YYYY-MM') as month"))
					.count('* as count')
					.groupBy(db.raw("TO_CHAR(date_created, 'YYYY-MM')"))
					.orderBy('month', 'asc'),
				// MRR: sum monthly_price for active subs (yearly subs / 12)
				db('subscriptions as s')
					.join('subscription_plans as sp', 'sp.id', 's.plan')
					.where('s.status', 'active')
					.select(db.raw(`COALESCE(SUM(
						CASE WHEN sp.yearly_price > 0 AND sp.monthly_price = 0
						THEN sp.yearly_price / 12
						ELSE sp.monthly_price END
					), 0) as mrr`))
					.first(),
				// Churned in last 30 days
				db('subscriptions')
					.whereIn('status', ['canceled', 'expired'])
					.where('date_updated', '>=', thirtyDaysAgo)
					.count('* as count')
					.first(),
				// Trial conversion
				db('subscriptions')
					.whereNotNull('trial_start')
					.select(
						db.raw("COUNT(*) FILTER (WHERE status = 'active') as converted"),
						db.raw("COUNT(*) as total_trials"),
					)
					.first(),
				// Account deletions per month (status != 'published' or archived)
				db('account')
					.where('date_updated', '>=', twelveMonthsAgo)
					.whereIn('status', ['archived', 'draft'])
					.select(db.raw("TO_CHAR(date_updated, 'YYYY-MM') as month"))
					.count('* as count')
					.groupBy(db.raw("TO_CHAR(date_updated, 'YYYY-MM')"))
					.orderBy('month', 'asc'),
				// Conversions per month (subscriptions that became active)
				db('subscriptions')
					.where('status', 'active')
					.where('date_updated', '>=', twelveMonthsAgo)
					.select(db.raw("TO_CHAR(date_updated, 'YYYY-MM') as month"))
					.count('* as count')
					.groupBy(db.raw("TO_CHAR(date_updated, 'YYYY-MM')"))
					.orderBy('month', 'asc'),
			]);

			const activeSubCount = subsByPlan.reduce((s: number, r: any) => s + (parseInt(r.count, 10) || 0), 0);

			return res.json({
				accounts: { total: parseInt((accountCount as any)?.count, 10) || 0 },
				subscriptions: {
					by_plan: subsByPlan.map((r: any) => ({ plan: r.plan_name, count: parseInt(r.count, 10) || 0 })),
				},
				calculators: {
					total: parseInt((calcTotal as any)?.count, 10) || 0,
					active: parseInt((calcActive as any)?.count, 10) || 0,
				},
				calls: {
					today: parseInt((callsToday as any)?.count, 10) || 0,
					week: parseInt((callsWeek as any)?.count, 10) || 0,
					month: parseInt((callsMonth as any)?.count, 10) || 0,
					errors_month: parseInt((errorsMonth as any)?.count, 10) || 0,
				},
				revenue: {
					mrr: parseInt((mrrResult as any)?.mrr, 10) || 0,
					active_subscriptions: activeSubCount,
					churned_30d: parseInt((churnedResult as any)?.count, 10) || 0,
					trial_total: parseInt((trialConversion as any)?.total_trials, 10) || 0,
					trial_converted: parseInt((trialConversion as any)?.converted, 10) || 0,
				},
				charts: {
					calls_per_day: callsPerDay.map((r: any) => ({
						date: r.date,
						total: parseInt(r.total, 10) || 0,
						errors: parseInt(r.errors, 10) || 0,
					})),
					accounts_per_month: accountsPerMonth.map((r: any) => ({
						month: r.month,
						count: parseInt(r.count, 10) || 0,
					})),
					deletions_per_month: deletionsPerMonth.map((r: any) => ({
						month: r.month,
						count: parseInt(r.count, 10) || 0,
					})),
					conversions_per_month: conversionsPerMonth.map((r: any) => ({
						month: r.month,
						count: parseInt(r.count, 10) || 0,
					})),
				},
			});
		} catch (err: any) {
			logger.error(`Admin overview failed: ${err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to fetch overview' }] });
		}
	});

	// GET /calc/admin/accounts — paginated account list with stats
	app.get('/calc/admin/accounts', requireAuth, requireAdmin, async (req: any, res: any) => {
		try {
			const { search, status, page = '1', limit = '25', sort = '-date_created' } = req.query;
			const pageNum = parseInt(page, 10) || 1;
			const limitNum = Math.min(parseInt(limit, 10) || 25, 100);
			const offset = (pageNum - 1) * limitNum;

			let query = db('account as a')
				.leftJoin('subscriptions as s', function () {
					this.on('s.account', 'a.id').andOnNotIn('s.status', ['canceled', 'expired']);
				})
				.leftJoin('subscription_plans as sp', 'sp.id', 's.plan')
				.select(
					'a.id', 'a.name', 'a.date_created', 'a.exempt_from_subscription',
					's.status as subscription_status', 's.trial_end',
					'sp.name as plan_name',
				);

			if (search) {
				query = query.where('a.name', 'ilike', `%${search}%`);
			}
			if (status) {
				query = query.where('s.status', status);
			}

			const countQuery = query.clone();
			const { count: total } = await countQuery.clearSelect().clearOrder().count('* as count').first() as any;

			const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
			const sortDir = sort.startsWith('-') ? 'desc' : 'asc';
			query = query.orderBy(sortField.includes('.') ? sortField : `a.${sortField}`, sortDir);

			const accounts = await query.offset(offset).limit(limitNum);

			// Enrich with calculator counts + monthly calls
			const accountIds = accounts.map((a: any) => a.id);
			if (accountIds.length > 0) {
				const now = new Date();
				const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

				const [calcCounts, monthlyCalls] = await Promise.all([
					db('calculators')
						.whereIn('account', accountIds)
						.groupBy('account')
						.select('account')
						.count('* as calculator_count')
						.sum({ active_count: db.raw("CASE WHEN activated = true THEN 1 ELSE 0 END") }),
					db('formula.calculator_calls as cc')
						.join('calculators as c', 'cc.calculator_id', 'c.id')
						.whereIn('c.account', accountIds)
						.where('cc.timestamp', '>=', monthStart)
						.groupBy('c.account')
						.select('c.account')
						.count('* as monthly_calls'),
				]);

				const calcMap = Object.fromEntries(calcCounts.map((r: any) => [r.account, {
					calculator_count: parseInt(r.calculator_count, 10) || 0,
					active_count: parseInt(r.active_count, 10) || 0,
				}]));
				const callsMap = Object.fromEntries(monthlyCalls.map((r: any) => [r.account, parseInt(r.monthly_calls, 10) || 0]));

				for (const acct of accounts) {
					(acct as any).calculator_count = calcMap[acct.id]?.calculator_count || 0;
					(acct as any).active_count = calcMap[acct.id]?.active_count || 0;
					(acct as any).monthly_calls = callsMap[acct.id] || 0;
				}
			}

			return res.json({ data: accounts, meta: { total: parseInt(total, 10) || 0, page: pageNum, limit: limitNum } });
		} catch (err: any) {
			logger.error(`Admin accounts failed: ${err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to fetch accounts' }] });
		}
	});

	// GET /calc/admin/accounts/:accountId — account detail
	app.get('/calc/admin/accounts/:accountId', requireAuth, requireAdmin, async (req: any, res: any) => {
		try {
			const { accountId } = req.params;

			const account = await db('account').where('id', accountId).first();
			if (!account) {
				return res.status(404).json({ errors: [{ message: 'Account not found' }] });
			}

			const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

			const now = new Date();
			const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

			const [subscription, calculators, usage] = await Promise.all([
				db('subscriptions as s')
					.leftJoin('subscription_plans as sp', 'sp.id', 's.plan')
					.where('s.account', accountId)
					.select('s.*', 'sp.name as plan_name', 'sp.calculator_limit', 'sp.calls_per_month', 'sp.calls_per_second')
					.first(),
				db('calculators')
					.where('account', accountId)
					.select('id', 'name', 'activated', 'over_limit', 'date_created', 'date_updated'),
				db('formula.calculator_calls as cc')
					.join('calculators as c', 'cc.calculator_id', 'c.id')
					.where('c.account', accountId)
					.where('cc.timestamp', '>=', thirtyDaysAgo)
					.select(db.raw("DATE(cc.timestamp) as date"))
					.count('* as total')
					.sum({ errors: db.raw("CASE WHEN cc.error = true THEN 1 ELSE 0 END") })
					.groupBy(db.raw("DATE(cc.timestamp)"))
					.orderBy('date', 'asc'),
			]);

			// Enrich calculators with profile + monthly calls
			const calcIds = calculators.map((c: any) => c.id);
			if (calcIds.length > 0) {
				const [configs, monthlyCalls] = await Promise.all([
					db('calculator_configs')
						.whereIn('calculator', calcIds)
						.select('calculator', 'test_environment', 'profile'),
					db('formula.calculator_calls')
						.whereIn('calculator_id', calcIds)
						.where('timestamp', '>=', monthStart)
						.groupBy('calculator_id')
						.select('calculator_id')
						.count('* as total_calls')
						.sum({ error_calls: db.raw("CASE WHEN error = true THEN 1 ELSE 0 END") }),
				]);

				const configMap: Record<string, any> = {};
				for (const cfg of configs) {
					if (!configMap[cfg.calculator]) configMap[cfg.calculator] = cfg;
					else if (!cfg.test_environment) configMap[cfg.calculator] = cfg;
				}
				const callsMap = Object.fromEntries(monthlyCalls.map((r: any) => [r.calculator_id, {
					total: parseInt(r.total_calls, 10) || 0,
					errors: parseInt(r.error_calls, 10) || 0,
				}]));

				for (const calc of calculators) {
					const cfg = configMap[calc.id];
					calc.profile = cfg?.profile
						? (typeof cfg.profile === 'string' ? JSON.parse(cfg.profile) : cfg.profile)
						: null;
					calc.monthly_calls = callsMap[calc.id]?.total || 0;
					calc.monthly_errors = callsMap[calc.id]?.errors || 0;
				}
			}

			return res.json({
				account,
				subscription,
				calculators,
				usage: usage.map((r: any) => ({
					date: r.date,
					total: parseInt(r.total, 10) || 0,
					errors: parseInt(r.errors, 10) || 0,
				})),
			});
		} catch (err: any) {
			logger.error(`Admin account detail failed: ${err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to fetch account' }] });
		}
	});

	// GET /calc/admin/calculators — cross-account calculator list
	app.get('/calc/admin/calculators', requireAuth, requireAdmin, async (req: any, res: any) => {
		try {
			const { search, page = '1', limit = '25', sort = '-date_created' } = req.query;
			const pageNum = parseInt(page, 10) || 1;
			const limitNum = Math.min(parseInt(limit, 10) || 25, 100);
			const offset = (pageNum - 1) * limitNum;

			let query = db('calculators as c')
				.leftJoin('account as a', 'a.id', 'c.account')
				.select(
					'c.id', 'c.name', 'c.activated', 'c.over_limit',
					'c.date_created', 'c.date_updated',
					'a.name as account_name', 'a.id as account_id',
				);

			if (search) {
				query = query.where(function () {
					this.where('c.name', 'ilike', `%${search}%`)
						.orWhere('c.id', 'ilike', `%${search}%`)
						.orWhere('a.name', 'ilike', `%${search}%`);
				});
			}

			const countQuery = query.clone();
			const { count: total } = await countQuery.clearSelect().clearOrder().count('* as count').first() as any;

			const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
			const sortDir = sort.startsWith('-') ? 'desc' : 'asc';
			query = query.orderBy(sortField.includes('.') ? sortField : `c.${sortField}`, sortDir);

			const calculators = await query.offset(offset).limit(limitNum);

			const calcIds = calculators.map((c: any) => c.id);
			if (calcIds.length > 0) {
				const now = new Date();
				const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

				const [configs, monthlyCalls] = await Promise.all([
					db('calculator_configs')
						.whereIn('calculator', calcIds)
						.select('calculator', 'test_environment', 'profile', 'config_version', 'file_version', 'unresolved_functions'),
					db('formula.calculator_calls')
						.whereIn('calculator_id', calcIds)
						.where('timestamp', '>=', monthStart)
						.groupBy('calculator_id')
						.select('calculator_id')
						.count('* as total_calls')
						.sum({ error_calls: db.raw("CASE WHEN error = true THEN 1 ELSE 0 END") }),
				]);

				const configMap: Record<string, any[]> = {};
				for (const cfg of configs) {
					if (!configMap[cfg.calculator]) configMap[cfg.calculator] = [];
					configMap[cfg.calculator].push(cfg);
				}

				const callsMap = Object.fromEntries(monthlyCalls.map((r: any) => [r.calculator_id, {
					total: parseInt(r.total_calls, 10) || 0,
					errors: parseInt(r.error_calls, 10) || 0,
				}]));

				for (const calc of calculators) {
					const cfgs = configMap[calc.id] || [];
					calc.monthly_calls = callsMap[calc.id]?.total || 0;
					calc.monthly_errors = callsMap[calc.id]?.errors || 0;

					const liveCfg = cfgs.find((c: any) => !c.test_environment);
					const testCfg = cfgs.find((c: any) => c.test_environment);
					const profileCfg = liveCfg || testCfg;
					calc.profile = profileCfg?.profile
						? (typeof profileCfg.profile === 'string' ? JSON.parse(profileCfg.profile) : profileCfg.profile)
						: null;
					const ufRaw = liveCfg?.unresolved_functions || testCfg?.unresolved_functions;
					calc.unresolved_functions = ufRaw
						? (typeof ufRaw === 'string' ? JSON.parse(ufRaw) : ufRaw)
						: null;
					calc.config_version = liveCfg?.config_version || testCfg?.config_version || null;
					calc.file_version = liveCfg?.file_version || testCfg?.file_version || null;
				}
			}

			return res.json({ data: calculators, meta: { total: parseInt(total, 10) || 0, page: pageNum, limit: limitNum } });
		} catch (err: any) {
			logger.error(`Admin calculators failed: ${err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to fetch calculators' }] });
		}
	});

	// GET /calc/admin/health-history — historical health snapshots
	app.get('/calc/admin/health-history', requireAuth, requireAdmin, async (req: any, res: any) => {
		try {
			const { days = '7' } = req.query;
			const daysNum = Math.min(parseInt(days, 10) || 7, 30);
			const since = new Date(Date.now() - daysNum * 86400000).toISOString();

			const snapshots = await db('system_health_snapshots')
				.where('date_created', '>=', since)
				.orderBy('date_created', 'asc')
				.select(
					'id', 'date_created', 'status', 'response_time_ms',
					'heap_used_mb', 'queue_pending', 'queue_max',
					'worker_count', 'cache_size', 'instance_count', 'total_calculators',
				);

			return res.json({ data: snapshots });
		} catch (err: any) {
			logger.error(`Admin health history failed: ${err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to fetch health history' }] });
		}
	});

	// GET /calc/admin/calculators/:calcId/errors — recent errors for a calculator
	app.get('/calc/admin/calculators/:calcId/errors', requireAuth, requireAdmin, async (req: any, res: any) => {
		try {
			const { calcId } = req.params;
			const { limit = '20' } = req.query;
			const limitNum = Math.min(parseInt(limit, 10) || 20, 100);

			const errors = await db('formula.calculator_calls')
				.where('calculator_id', calcId)
				.where('error', true)
				.orderBy('timestamp', 'desc')
				.limit(limitNum)
				.select('id', 'timestamp', 'error_message', 'response_time_ms', 'test', 'cached');

			return res.json({ data: errors });
		} catch (err: any) {
			logger.error(`Admin calculator errors failed: ${err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to fetch errors' }] });
		}
	});

	// POST /calc/admin/extend-trial
	app.post('/calc/admin/extend-trial', requireAuth, requireAdmin, async (req: any, res: any) => {
		try {
			const { accountId, days } = req.body;
			if (!accountId || !days) {
				return res.status(400).json({ errors: [{ message: 'Missing accountId or days' }] });
			}

			const sub = await db('subscriptions').where('account', accountId).first();
			if (!sub) {
				return res.status(404).json({ errors: [{ message: 'Subscription not found' }] });
			}

			const currentEnd = sub.trial_end ? new Date(sub.trial_end) : new Date();
			const newEnd = new Date(Math.max(currentEnd.getTime(), Date.now()) + parseInt(days, 10) * 86400000);

			await db('subscriptions').where('account', accountId).update({
				trial_end: newEnd.toISOString(),
				status: 'trialing',
			});

			return res.json({ trial_end: newEnd.toISOString() });
		} catch (err: any) {
			logger.error(`Extend trial failed: ${err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to extend trial' }] });
		}
	});

	// POST /calc/admin/set-exempt
	app.post('/calc/admin/set-exempt', requireAuth, requireAdmin, async (req: any, res: any) => {
		try {
			const { accountId, exempt } = req.body;
			if (!accountId || typeof exempt !== 'boolean') {
				return res.status(400).json({ errors: [{ message: 'Missing accountId or exempt (boolean)' }] });
			}

			await db('account').where('id', accountId).update({ exempt_from_subscription: exempt });

			return res.json({ exempt });
		} catch (err: any) {
			logger.error(`Set exempt failed: ${err}`);
			return res.status(500).json({ errors: [{ message: 'Failed to update exemption' }] });
		}
	});

	logger.info('Admin dashboard routes registered');
}
