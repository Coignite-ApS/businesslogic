import { defineModule } from '@directus/extensions-sdk';
import CostBudget from './routes/cost-budget.vue';
import ConversationQuality from './routes/conversation-quality.vue';
import ToolAnalytics from './routes/tool-analytics.vue';
import RetrievalPerformance from './routes/retrieval-performance.vue';
import ModelPerformance from './routes/model-performance.vue';
import BillingHealth from './routes/billing-health.vue';

export default defineModule({
	id: 'ai-observatory',
	name: 'AI Observatory',
	icon: 'monitoring',
	preRegisterCheck(user) {
		return user.admin_access;
	},
	routes: [
		{ path: '', redirect: '/ai-observatory/cost' },
		{ path: 'cost', component: CostBudget },
		{ path: 'quality', component: ConversationQuality },
		{ path: 'tools', component: ToolAnalytics },
		{ path: 'retrieval', component: RetrievalPerformance },
		{ path: 'models', component: ModelPerformance },
		{ path: 'billing-health', component: BillingHealth },
	],
});
