import { defineModule } from '@directus/extensions-sdk';
import CostBudget from './routes/cost-budget.vue';
import ConversationQuality from './routes/conversation-quality.vue';
import ToolAnalytics from './routes/tool-analytics.vue';
import RetrievalPerformance from './routes/retrieval-performance.vue';

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
	],
});
