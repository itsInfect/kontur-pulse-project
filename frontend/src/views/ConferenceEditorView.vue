<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDemoStore } from '../stores/demo'

const route = useRoute()
const router = useRouter()
const store = useDemoStore()
const existing = computed(() => store.conferences.find((item) => item.id === route.params.id))
const editing = computed(() => !!route.params.id)
const title = ref('')
const description = ref('')
const date = ref('')
const time = ref('')
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const allowGuests = ref(localStorage.getItem('pulse-allow-guests') !== 'false')
const error = ref('')
const busy = ref(false)
const draftLink = computed(() => existing.value ? `${window.location.origin}/join/${existing.value.slug}` : 'Ссылка появится после создания')
watch(existing, (conference) => {
  if (!conference) return
  title.value = conference.title; description.value = conference.description; allowGuests.value = conference.allowGuests
  const start = new Date(conference.startsAt)
  date.value = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  time.value = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
}, { immediate: true })
if (!editing.value) {
  const start = new Date(Date.now() + 86400000)
  date.value = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  time.value = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
}
onMounted(() => { if (editing.value && !existing.value) store.loadConference(String(route.params.id)).catch((cause) => { error.value = cause instanceof Error ? cause.message : 'Встреча не найдена' }) })
async function copy() { if (existing.value) await navigator.clipboard.writeText(draftLink.value).catch(() => { error.value = 'Не удалось скопировать ссылку' }) }
async function save() {
  error.value = ''
  if (!title.value.trim() || !date.value || !time.value) { error.value = 'Заполните название, дату и время'; return }
  const startsAt = new Date(`${date.value}T${time.value}:00`).toISOString()
  const data = { title: title.value.trim(), description: description.value.trim(), startsAt, allowGuests: allowGuests.value }
  busy.value = true
  try {
    if (editing.value && existing.value) await store.updateConference(existing.value.id, data)
    else await store.createConference(data)
    await router.push('/conferences')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить встречу' }
  finally { busy.value = false }
}
</script>

<template>
  <section class="page conference-editor-page">
    <div class="eyebrow"><router-link to="/conferences">Конференции</router-link> &nbsp;/&nbsp; {{ editing ? 'Изменить конференцию' : 'Новая конференция' }}</div>
    <h1>{{ editing ? 'Изменить конференцию' : 'Создать конференцию' }}</h1>
    <div v-if="editing && !existing" class="surface empty-state"><h2>Встреча не найдена</h2><v-btn to="/conferences" color="primary">Вернуться к встречам</v-btn></div>
    <div v-else class="conference-editor-grid">
      <form class="conference-form" @submit.prevent="save">
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
        <label class="form-label" for="conference-name">Название</label><input id="conference-name" v-model="title" class="form-input" maxlength="120" placeholder="Название встречи" />
        <label class="form-label" for="conference-description">Описание</label><textarea id="conference-description" v-model="description" class="form-input" rows="3" placeholder="О чём будет встреча?" />
        <div class="conference-time-grid"><div><label class="form-label" for="conference-date">Дата</label><input id="conference-date" v-model="date" class="form-input" type="date" /></div><div><label class="form-label" for="conference-time">Время начала</label><input id="conference-time" v-model="time" class="form-input" type="time" /></div></div>
        <p class="muted">Время указывается в часовом поясе вашего браузера: {{ timeZone }}.</p>
        <div class="conference-switches"><label class="settings-row"><span><strong>Разрешить вход по ссылке</strong><small>Внешние участники смогут подключаться без регистрации</small></span><input v-model="allowGuests" type="checkbox" class="switch-input" /></label></div>
        <button v-if="existing" type="button" class="draft-link" @click="copy"><span class="draft-link-icon">↔</span><span><small>ССЫЛКА ДЛЯ УЧАСТНИКОВ</small><strong>{{ draftLink }}</strong></span><v-icon icon="mdi-content-copy" size="18" /></button>
        <div class="conference-form-actions"><v-btn type="submit" color="primary" :loading="busy">{{ editing ? 'Сохранить изменения' : 'Создать конференцию' }}</v-btn><v-btn variant="outlined" to="/conferences">Отмена</v-btn></div>
      </form>
      <aside class="conference-preview"><div class="surface conference-preview-card"><div class="preview-badge">ЧЕРНОВИК</div><h2>{{ title || 'Название новой конференции' }}</h2><p class="muted">{{ description || 'Описание встречи появится здесь.' }}</p><div class="preview-info"><div><v-icon icon="mdi-calendar-month-outline" size="17" />{{ date }}</div><div><v-icon icon="mdi-clock-outline" size="17" />{{ time }} ({{ timeZone }})</div></div></div><div class="preview-tip"><v-icon icon="mdi-help-circle-outline" size="19" /><span>После создания встречи вы получите ссылку для участников.</span></div></aside>
    </div>
  </section>
</template>
