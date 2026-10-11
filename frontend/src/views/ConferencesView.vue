<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDemoStore, type Conference, type ConferenceStatus } from '../stores/demo'
import { api, json } from '../lib/api'

const store = useDemoStore()
const router = useRouter()
const origin = window.location.origin
const copied = ref(false)
const error = ref('')
const busy = ref(false)
const confirmAction = ref<{ id: string; type: 'cancel' | 'end' } | null>(null)
interface Moderator { userId: string; canEnd: boolean; user: { name: string; email: string } }
const moderatorConference = ref<Conference | null>(null)
const moderators = ref<Moderator[]>([])
const moderatorEmail = ref('')
const moderatorCanEnd = ref(false)
const moderatorBusy = ref(false)
const moderatorError = ref('')
const featured = computed(() => store.conferences.find((item) => item.status === 'SCHEDULED') || store.conferences.find((item) => item.status === 'LIVE'))
const statusInfo: Record<ConferenceStatus, { label: string; color: string }> = {
  SCHEDULED: { label: 'Запланирована', color: 'success' }, LIVE: { label: 'В эфире', color: 'error' },
  ENDED: { label: 'Завершена', color: 'secondary' }, CANCELLED: { label: 'Отменена', color: 'secondary' },
}
function formatDate(value: string) { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
async function copy(slug: string) {
  try { await navigator.clipboard.writeText(`${window.location.origin}/join/${slug}`); copied.value = true } catch { copied.value = false }
}
async function open(item: Conference) {
  busy.value = true; error.value = ''
  try {
    if (item.status === 'SCHEDULED') await store.changeConference(item.id, 'start')
    else await store.join(item.slug, store.userName)
    await router.push(`/conference/${item.id}`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось открыть встречу' }
  finally { busy.value = false }
}
async function confirm() {
  if (!confirmAction.value) return
  busy.value = true; error.value = ''
  try { await store.changeConference(confirmAction.value.id, confirmAction.value.type); confirmAction.value = null }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось изменить встречу' }
  finally { busy.value = false }
}
async function manageModerators(item: Conference) {
  moderatorConference.value = item; moderatorEmail.value = ''; moderatorCanEnd.value = false; moderatorError.value = ''
  try { moderators.value = await api<Moderator[]>(`/conferences/${item.id}/moderators`) }
  catch (cause) { moderatorError.value = cause instanceof Error ? cause.message : 'Не удалось загрузить модераторов' }
}
async function addModerator() {
  if (!moderatorConference.value || !moderatorEmail.value.trim()) return
  moderatorBusy.value = true; moderatorError.value = ''
  try {
    await api(`/conferences/${moderatorConference.value.id}/moderators`, { method: 'POST', body: json({ email: moderatorEmail.value.trim(), canEnd: moderatorCanEnd.value }) })
    moderators.value = await api<Moderator[]>(`/conferences/${moderatorConference.value.id}/moderators`)
    moderatorEmail.value = ''; moderatorCanEnd.value = false
  } catch (cause) { moderatorError.value = cause instanceof Error ? cause.message : 'Не удалось назначить модератора' }
  finally { moderatorBusy.value = false }
}
async function removeModerator(userId: string) {
  if (!moderatorConference.value) return
  moderatorBusy.value = true; moderatorError.value = ''
  try {
    await api(`/conferences/${moderatorConference.value.id}/moderators/${userId}`, { method: 'DELETE' })
    moderators.value = moderators.value.filter((person) => person.userId !== userId)
  } catch (cause) { moderatorError.value = cause instanceof Error ? cause.message : 'Не удалось снять модератора' }
  finally { moderatorBusy.value = false }
}
onMounted(() => { store.loadConferences().catch((cause) => { error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить встречи' }) })
</script>

<template>
  <section class="page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <header class="page-heading">
      <div><h1>Мои конференции</h1><p class="muted">Управляйте встречами, создавайте опросы и запускайте эфиры прямо из личного кабинета Kontur Pulse.</p></div>
      <v-btn color="primary" prepend-icon="mdi-plus" to="/conferences/create">Создать конференцию</v-btn>
    </header>
    <template v-if="store.conferences.length">
      <div v-if="featured" class="surface feature-card mb-7">
        <div class="d-flex align-center justify-space-between ga-2 flex-wrap"><div class="d-flex align-center ga-3"><span class="card-kicker">БЛИЖАЙШАЯ ВСТРЕЧА</span><span class="feature-status">{{ statusInfo[featured.status].label }}</span></div><span class="feature-date"><v-icon icon="mdi-calendar-month-outline" size="17" /> {{ formatDate(featured.startsAt) }}</span></div>
        <h2>{{ featured.title }}</h2>
        <p class="muted feature-link">Ссылка на встречу: <a href="#" @click.prevent="copy(featured.slug)">{{ origin }}/join/{{ featured.slug }}</a></p>
        <div class="card-actions"><v-btn color="primary" prepend-icon="mdi-video-outline" @click="open(featured)">{{ featured.status === 'LIVE' ? 'Войти' : 'Запустить' }}</v-btn><v-btn variant="outlined" prepend-icon="mdi-content-copy" @click="copy(featured.slug)">Скопировать ссылку</v-btn></div>
      </div>
      <div class="d-flex align-center justify-space-between"><h2 class="section-title mb-0">Предыдущие и будущие встречи</h2></div>
      <div class="surface table-scroll conference-table">
        <table class="list-table">
          <thead><tr><th>НАЗВАНИЕ ВСТРЕЧИ</th><th>ДАТА И ВРЕМЯ</th><th>ССЫЛКА</th><th>СТАТУС</th><th>ДЕЙСТВИЯ</th></tr></thead>
          <tbody>
            <tr v-for="item in store.conferences" :key="item.id">
              <td><div class="font-weight-bold table-title">{{ item.title }}</div></td>
              <td class="text-no-wrap"><v-icon icon="mdi-calendar-month-outline" size="16" class="mr-1" />{{ formatDate(item.startsAt) }}</td>
              <td><a href="#" class="text-link table-link" @click.prevent="copy(item.slug)">/join/{{ item.slug }}</a></td>
              <td><v-chip size="small" :color="statusInfo[item.status].color" variant="tonal" class="status-chip"><span class="status-dot" :class="item.status.toLowerCase()" />{{ statusInfo[item.status].label }}</v-chip></td>
              <td class="text-right text-no-wrap">
                <v-btn v-if="item.status === 'LIVE' || item.status === 'SCHEDULED'" size="small" color="primary" variant="text" :loading="busy" @click="open(item)">{{ item.status === 'LIVE' ? 'Войти' : 'Запустить' }}</v-btn>
                <v-btn icon="mdi-content-copy" size="small" variant="text" aria-label="Скопировать ссылку" @click="copy(item.slug)" />
                <v-menu>
                  <template #activator="{ props }"><v-btn icon="mdi-dots-vertical" size="small" variant="text" aria-label="Меню встречи" v-bind="props" /></template>
                  <v-list density="compact" min-width="190">
                    <v-list-item prepend-icon="mdi-link-variant" title="Скопировать ссылку" @click="copy(item.slug)" />
                    <v-list-item v-if="item.status === 'SCHEDULED' || item.status === 'LIVE'" prepend-icon="mdi-account-key-outline" title="Модераторы" @click="manageModerators(item)" />
                    <v-list-item v-if="item.status === 'SCHEDULED'" prepend-icon="mdi-pencil-outline" title="Изменить" :to="`/conferences/${item.id}/edit`" />
                    <v-list-item v-if="item.status === 'SCHEDULED'" prepend-icon="mdi-close-circle-outline" title="Отменить встречу" @click="confirmAction = { id: item.id, type: 'cancel' }" />
                    <v-list-item v-if="item.status === 'LIVE'" prepend-icon="mdi-stop-circle-outline" title="Завершить для всех" @click="confirmAction = { id: item.id, type: 'end' }" />
                  </v-list>
                </v-menu>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mobile-meetings">
        <div v-for="item in store.conferences" :key="item.id" class="surface mobile-meeting">
          <div class="d-flex align-start justify-space-between ga-2"><v-chip size="x-small" :color="statusInfo[item.status].color" variant="tonal">{{ statusInfo[item.status].label }}</v-chip><v-menu><template #activator="{ props }"><v-btn icon="mdi-dots-vertical" size="x-small" variant="text" aria-label="Меню встречи" v-bind="props" /></template><v-list density="compact"><v-list-item prepend-icon="mdi-link-variant" title="Скопировать ссылку" @click="copy(item.slug)" /><v-list-item v-if="item.status === 'SCHEDULED' || item.status === 'LIVE'" prepend-icon="mdi-account-key-outline" title="Модераторы" @click="manageModerators(item)" /><v-list-item v-if="item.status === 'SCHEDULED'" prepend-icon="mdi-pencil-outline" title="Изменить" :to="`/conferences/${item.id}/edit`" /><v-list-item v-if="item.status === 'SCHEDULED'" prepend-icon="mdi-close-circle-outline" title="Отменить встречу" @click="confirmAction = { id: item.id, type: 'cancel' }" /><v-list-item v-if="item.status === 'LIVE'" prepend-icon="mdi-stop-circle-outline" title="Завершить для всех" @click="confirmAction = { id: item.id, type: 'end' }" /></v-list></v-menu></div>
          <h3>{{ item.title }}</h3><p class="muted">{{ formatDate(item.startsAt) }}</p>
          <v-btn v-if="item.status === 'LIVE' || item.status === 'SCHEDULED'" color="primary" size="small" block @click="open(item)">{{ item.status === 'LIVE' ? 'Войти во встречу' : 'Запустить' }}</v-btn>
        </div>
      </div>
    </template>
    <template v-else><div class="surface empty-state"><div class="empty-icon"><v-icon icon="mdi-video-off-outline" size="32" /></div><h2>У вас пока нет запланированных встреч</h2><p class="muted">Создайте новую мгновенную конференцию или запланируйте встречу на будущее, чтобы отправить ссылку коллегам.</p><v-btn color="primary" prepend-icon="mdi-plus-circle-outline" to="/conferences/create">Запланировать первую встречу</v-btn></div><p class="muted text-center mt-12">Здесь появятся ваши запланированные и завершённые встречи</p></template>
    <v-snackbar v-model="copied" timeout="2000" color="success">Ссылка скопирована</v-snackbar>
    <v-dialog :model-value="!!confirmAction" max-width="440" @update:model-value="confirmAction = null"><v-card class="pa-5"><h2 class="text-h6 mb-2">{{ confirmAction?.type === 'end' ? 'Завершить встречу для всех?' : 'Отменить встречу?' }}</h2><p class="dialog-copy">{{ confirmAction?.type === 'end' ? 'Участники покинут комнату. Вернуться в неё будет нельзя.' : 'Участники больше не смогут войти по ссылке.' }}</p><div class="d-flex justify-end ga-2 mt-4"><v-btn variant="text" @click="confirmAction = null">Назад</v-btn><v-btn color="error" @click="confirm">{{ confirmAction?.type === 'end' ? 'Завершить' : 'Отменить встречу' }}</v-btn></div></v-card></v-dialog>
    <v-dialog :model-value="!!moderatorConference" max-width="540" @update:model-value="moderatorConference = null"><v-card class="pa-5"><h2 class="text-h6 mb-2">Модераторы встречи</h2><p class="muted mb-4">{{ moderatorConference?.title }}. Модератор должен зарегистрироваться и подтвердить почту.</p><v-alert v-if="moderatorError" type="error" variant="tonal" class="mb-3">{{ moderatorError }}</v-alert><form @submit.prevent="addModerator"><v-text-field v-model="moderatorEmail" label="Почта модератора" type="email" variant="outlined" density="comfortable" /><v-checkbox v-model="moderatorCanEnd" label="Разрешить завершать встречу" density="compact" /><v-btn type="submit" color="primary" :loading="moderatorBusy" :disabled="!moderatorEmail.trim()">Назначить</v-btn></form><v-list v-if="moderators.length" class="mt-3"><v-list-item v-for="person in moderators" :key="person.userId" :title="person.user.name" :subtitle="`${person.user.email}${person.canEnd ? ' · может завершать встречу' : ''}`"><template #append><v-btn icon="mdi-delete-outline" variant="text" color="error" size="small" :disabled="moderatorBusy" :aria-label="`Снять модератора ${person.user.name}`" @click="removeModerator(person.userId)" /></template></v-list-item></v-list><v-card-actions class="justify-end"><v-btn variant="text" @click="moderatorConference = null">Закрыть</v-btn></v-card-actions></v-card></v-dialog>
  </section>
</template>
