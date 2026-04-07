import { defineModule } from '@directus/extensions-sdk';
import OverviewPage from './routes/overview.vue';
import AccountsPage from './routes/accounts.vue';
import CalculatorsPage from './routes/calculators.vue';
import InfrastructurePage from './routes/infrastructure.vue';
import AiPage from './routes/ai.vue';
import FeaturesPage from './routes/features.vue';

export default defineModule({
	id: 'admin-dashboard',
	name: 'Admin',
	icon: 'admin_panel_settings',
	preRegisterCheck(user) {
		return user.admin_access;
	},
	routes: [
		{ path: '', redirect: '/admin-dashboard/overview' },
		{ path: 'overview', component: OverviewPage },
		{ path: 'accounts', component: AccountsPage },
		{ path: 'accounts/:accountId', component: AccountsPage },
		{ path: 'calculators', component: CalculatorsPage },
		{ path: 'infrastructure', component: InfrastructurePage },
		{ path: 'ai', component: AiPage },
		{ path: 'features', component: FeaturesPage },
	],
});
