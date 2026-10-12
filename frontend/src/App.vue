<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDemoStore } from './stores/demo'
const RoomView = defineAsyncComponent(() => import('./views/RoomView.vue'))

const route = useRoute()
const router = useRouter()
const store = useDemoStore()
const mobileMenu = ref(false)
const isRoomRoute = computed(() => route.path.startsWith('/conference/'))
const showShell = computed(() => !route.meta.public && !isRoomRoute.value)
const activeConference = computed(() => store.conferences.find((item) => item.id === store.activeRoomId))
const showActiveRoom = computed(() => isRoomRoute.value || (showShell.value && !!store.activeRoomId && !!store.participantId && activeConference.value?.status === 'LIVE'))
watch(() => route.fullPath, () => {
  if (isRoomRoute.value) {
    const id = String(route.params.id)
    if (store.activeRoomId !== id || store.roomMinimized) store.openRoom(id)
  } else if (store.activeRoomId && !store.roomMinimized) {
    store.minimizeRoom()
  }
}, { immediate: true })
const initials = computed(() => (store.userName || 'Пользователь').split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase())
async function signOut() { await store.signOut(); router.push('/login') }
</script>

<template>
  <v-app>
    <div v-if="showShell" class="app-shell">
      <aside class="sidebar" :class="{ 'sidebar-open': mobileMenu }">
        <router-link class="brand" to="/conferences" @click="mobileMenu = false">
          <span class="brand-mark"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9v6m3-9v12m3-8v4m3-11v18m3-13v8m3-11v14m3-10v6" /></svg></span>
          <span class="brand-text"><strong>Kontur Pulse</strong><small>Видеоконференции</small></span>
        </router-link>
        <nav class="sidebar-nav" aria-label="Основное меню" @click="mobileMenu = false">
          <router-link to="/conferences" :class="{ 'nav-current': route.path.startsWith('/conferences') }"><v-icon icon="mdi-video-off-outline" size="19" /><span>Конференции</span></router-link>
          <router-link to="/polls" :class="{ 'nav-current': route.path.startsWith('/polls') }"><v-icon icon="mdi-poll" size="19" /><span>Опросы</span></router-link>
          <router-link to="/settings"><v-icon icon="mdi-cog-outline" size="19" /><span>Настройки</span></router-link>
        </nav>
        <div class="sidebar-bottom">
          <span class="avatar">{{ initials }}</span>
          <span class="profile-name">{{ store.userName || 'Пользователь' }}<small>{{ store.profileEmail }}</small></span>
          <v-btn icon="mdi-logout" variant="text" size="small" aria-label="Выйти" @click="signOut" />
        </div>
      </aside>
      <div v-if="mobileMenu" class="mobile-backdrop" @click="mobileMenu = false" />
      <main class="app-main" :class="{ 'has-miniplayer': showActiveRoom }">
        <div class="mobile-bar"><button class="menu-trigger" aria-label="Открыть меню" @click="mobileMenu = true"><v-icon icon="mdi-menu" /></button><span class="brand-mark"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 9v6m3-9v12m3-8v4m3-11v18m3-13v8m3-11v14m3-10v6" /></svg></span><strong>Kontur Pulse</strong></div>
        <router-view />
      </main>
    </div>
    <router-view v-else-if="!isRoomRoute" />
    <RoomView v-if="showActiveRoom" :key="isRoomRoute ? String(route.params.id) : store.activeRoomId" :conference-id="store.activeRoomId" />
  </v-app>
</template>
