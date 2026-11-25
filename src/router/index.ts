import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const editor = () => import('@/views/EditorView.vue')

/**
 * Öffentlich: Startseite unter `/`, Editor unter `/app`.
 * Privat (Eigennutzung): ohne Startseite, der Editor bleibt unter `/`.
 */
export const routes: RouteRecordRaw[] = __PRIVATE__
  ? [
      { path: '/', name: 'editor', component: editor },
      { path: '/:pathMatch(.*)*', redirect: { name: 'editor' } },
    ]
  : [
      { path: '/', name: 'landing', component: () => import('@/views/LandingView.vue') },
      { path: '/app', name: 'editor', component: editor },
      { path: '/:pathMatch(.*)*', redirect: { name: 'landing' } },
    ]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
