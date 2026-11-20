import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'editor',
      component: () => import('@/views/EditorView.vue'),
    },
    { path: '/:pathMatch(.*)*', redirect: { name: 'editor' } },
  ],
})

export default router
