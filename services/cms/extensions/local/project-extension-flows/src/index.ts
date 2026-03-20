import { defineModule } from '@directus/extensions-sdk';
import FlowList from './routes/flow-list.vue';
import FlowEditor from './routes/flow-editor.vue';
import FlowExecutions from './routes/flow-executions.vue';

export default defineModule({
	id: 'flows',
	name: 'Flows',
	icon: 'account_tree',
	routes: [
		{
			path: '',
			component: FlowList,
		},
		{
			path: ':id',
			component: FlowEditor,
		},
		{
			path: ':id/executions',
			component: FlowExecutions,
		},
	],
});
