import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './routes/module.vue';
import ConfigurePage from './routes/configure.vue';
import TestPage from './routes/test.vue';
import IntegrationPage from './routes/integration.vue';

export default defineModule({
	id: 'calculators',
	name: 'Calculators',
	icon: 'calculate',
	routes: [
		{
			path: '',
			component: ModuleComponent,
		},
		{
			path: ':id',
			component: ModuleComponent,
		},
		{
			path: ':id/configure',
			component: ConfigurePage,
		},
		{
			path: ':id/test',
			component: TestPage,
		},
		{
			path: ':id/integration',
			component: IntegrationPage,
		},
	],
});
