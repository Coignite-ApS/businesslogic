import { defineModule } from '@directus/extensions-sdk';
import TestView from './routes/test.vue';
import IntegrationView from './routes/integration.vue';

export default defineModule({
	id: 'formulas',
	name: 'Formulas',
	icon: 'functions',
	routes: [
		{
			path: '',
			component: TestView,
		},
		{
			path: 'integration',
			component: IntegrationView,
		},
	],
});
