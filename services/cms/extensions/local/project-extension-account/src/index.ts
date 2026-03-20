import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './routes/module.vue';
import SubscriptionPage from './routes/subscription.vue';

export default defineModule({
	id: 'account',
	name: 'Account',
	icon: 'account_circle',
	routes: [
		{
			path: '',
			component: ModuleComponent,
		},
		{
			path: 'subscription',
			component: SubscriptionPage,
		},
	],
});
