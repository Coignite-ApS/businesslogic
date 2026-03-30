import { defineModule } from '@directus/extensions-sdk';
import BuilderPage from './routes/builder.vue';
import ListPage from './routes/list.vue';

export default defineModule({
  id: 'layout-builder',
  name: 'Layout Builder',
  icon: 'dashboard_customize',
  routes: [
    { path: '', component: ListPage },
    { path: 'new', component: BuilderPage },
    { path: ':id', component: BuilderPage },
  ],
  preRegisterCheck(user) {
    return user.admin_access;
  },
});
