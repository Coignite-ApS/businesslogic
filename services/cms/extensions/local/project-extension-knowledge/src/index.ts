import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './routes/module.vue';

export default defineModule({
	id: 'knowledge',
	name: 'Knowledge',
	icon: 'menu_book',
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
