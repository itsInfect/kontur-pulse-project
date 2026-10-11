import { createRouter, createWebHistory } from 'vue-router'
import AuthView from './views/AuthView.vue'
import ConferencesView from './views/ConferencesView.vue'
import ConferenceEditorView from './views/ConferenceEditorView.vue'
import PrejoinView from './views/PrejoinView.vue'
import PollsView from './views/PollsView.vue'
import PollEditorView from './views/PollEditorView.vue'
import SettingsView from './views/SettingsView.vue'
import { useDemoStore } from './stores/demo'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/conferences' },
    { path: '/login', component: AuthView, meta: { public: true } },
    { path: '/register', component: AuthView, props: { mode: 'register' }, meta: { public: true } },
    { path: '/forgot-password', component: AuthView, props: { mode: 'forgot' }, meta: { public: true } },
    { path: '/verify-email', component: AuthView, props: { mode: 'verify' }, meta: { public: true } },
    { path: '/reset-password', component: AuthView, props: { mode: 'reset' }, meta: { public: true } },
    { path: '/conferences', component: ConferencesView },
    { path: '/conferences/create', component: ConferenceEditorView },
    { path: '/conferences/:id/edit', component: ConferenceEditorView },
    { path: '/join/:slug', component: PrejoinView, meta: { public: true } },
    { path: '/conference/:id', component: () => import('./views/RoomView.vue'), meta: { public: true } },
    { path: '/polls', component: PollsView },
    { path: '/polls/create', component: PollEditorView },
    { path: '/settings', component: SettingsView },
    { path: '/:pathMatch(.*)*', redirect: '/conferences' },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta.public) return
  const store = useDemoStore()
  if (!await store.restore()) return { path: '/login', query: { next: to.fullPath } }
  if (!store.conferences.length) await store.loadConferences().catch(() => null)
})

export default router
