import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './module.vue';

export default defineModule({
	id: 'ai-assistant',
	name: 'AI Assistant',
	icon: 'smart_toy',
	routes: [
		{
			path: '',
			component: ModuleComponent,
		},
		{
			path: ':id',
			component: ModuleComponent,
		},
	],
});
