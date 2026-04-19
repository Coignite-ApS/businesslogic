import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './routes/module.vue';
import SubscriptionPage from './routes/subscription.vue';
import OnboardingPage from './routes/onboarding.vue';

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
		{
			path: 'onboarding',
			component: OnboardingPage,
		},
	],
});
